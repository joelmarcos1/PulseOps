#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd "${script_dir}/../.." && pwd)
terraform_dir="${project_dir}/infra/terraform"
image_tag="${PULSEOPS_IMAGE_TAG:-manual}"
image_platform="${PULSEOPS_IMAGE_PLATFORM:-linux/amd64}"

if [[ ! "${image_tag}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "PULSEOPS_IMAGE_TAG may only contain letters, numbers, ., _ and -." >&2
  exit 1
fi

if [[ -z "${PULSEOPS_DB_PASSWORD:-}" ]]; then
  echo "Set PULSEOPS_DB_PASSWORD to a 16-64 character value before deploying." >&2
  exit 1
fi

if [[ ! "${PULSEOPS_DB_PASSWORD}" =~ ^[A-Za-z0-9_-]{16,64}$ ]]; then
  echo "PULSEOPS_DB_PASSWORD may only contain letters, numbers, _ and -." >&2
  exit 1
fi

public_ip=$(terraform -chdir="${terraform_dir}" output -raw public_ip)
ssh_key=$(terraform -chdir="${terraform_dir}" output -raw ssh_private_key_path)
ssh_target="ubuntu@${public_ip}"
ssh_options=(-i "${ssh_key}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

echo "Waiting for SSH and k3s on ${public_ip}..."
ready=false
for attempt in $(seq 1 60); do
  if ssh "${ssh_options[@]}" "${ssh_target}" \
    "test -f /var/lib/pulseops-k3s-ready && sudo k3s kubectl get node >/dev/null"; then
    ready=true
    break
  fi
  sleep 10
done

if [[ "${ready}" != true ]]; then
  echo "k3s did not become ready within 10 minutes." >&2
  exit 1
fi

echo "Building and transferring pulseops:${image_tag} for ${image_platform}..."
docker build --platform "${image_platform}" --tag "pulseops:${image_tag}" "${project_dir}"
docker save "pulseops:${image_tag}" \
  | gzip \
  | ssh "${ssh_options[@]}" "${ssh_target}" \
      "gunzip | sudo k3s ctr images import -"

tar -C "${project_dir}" -czf - k8s db/init.sql \
  | ssh "${ssh_options[@]}" "${ssh_target}" \
      "mkdir -p /home/ubuntu/pulseops-deploy && tar -xzf - -C /home/ubuntu/pulseops-deploy"

ssh "${ssh_options[@]}" "${ssh_target}" \
  "sudo k3s kubectl apply -f /home/ubuntu/pulseops-deploy/k8s/namespace.yaml"

db_password_b64=$(printf '%s' "${PULSEOPS_DB_PASSWORD}" | base64 | tr -d '\n')
database_url="postgresql://pulseops:${PULSEOPS_DB_PASSWORD}@postgres:5432/pulseops"
database_url_b64=$(printf '%s' "${database_url}" | base64 | tr -d '\n')

{
  printf '%s\n' 'apiVersion: v1'
  printf '%s\n' 'kind: Secret'
  printf '%s\n' 'metadata:'
  printf '%s\n' '  name: pulseops-secrets'
  printf '%s\n' '  namespace: pulseops'
  printf '%s\n' 'type: Opaque'
  printf '%s\n' 'data:'
  printf '  POSTGRES_PASSWORD: %s\n' "${db_password_b64}"
  printf '  DATABASE_URL: %s\n' "${database_url_b64}"
} | ssh "${ssh_options[@]}" "${ssh_target}" \
      "sudo k3s kubectl apply -f -"

ssh "${ssh_options[@]}" "${ssh_target}" bash <<'REMOTE_COMMANDS'
set -euo pipefail

sudo k3s kubectl -n pulseops create configmap postgres-init \
  --from-file=001-schema.sql=/home/ubuntu/pulseops-deploy/db/init.sql \
  --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f -

sudo k3s kubectl apply -f /home/ubuntu/pulseops-deploy/k8s/configmap.yaml
sudo k3s kubectl apply -f /home/ubuntu/pulseops-deploy/k8s/postgres.yaml
sudo k3s kubectl -n pulseops rollout status statefulset/postgres --timeout=180s
sudo k3s kubectl apply -f /home/ubuntu/pulseops-deploy/k8s/api.yaml
sudo k3s kubectl apply -f /home/ubuntu/pulseops-deploy/k8s/worker.yaml
REMOTE_COMMANDS

ssh "${ssh_options[@]}" "${ssh_target}" \
  "sudo k3s kubectl -n pulseops set image deployment/pulseops-api api=pulseops:${image_tag} && \
   sudo k3s kubectl -n pulseops set image deployment/pulseops-worker worker=pulseops:${image_tag} && \
   sudo k3s kubectl -n pulseops rollout restart deployment/pulseops-api deployment/pulseops-worker && \
   sudo k3s kubectl -n pulseops rollout status deployment/pulseops-api --timeout=180s && \
   sudo k3s kubectl -n pulseops rollout status deployment/pulseops-worker --timeout=180s && \
   sudo k3s kubectl -n pulseops get pods,services,pvc"

echo "PulseOps is available from the trusted IP at http://${public_ip}:30080"
