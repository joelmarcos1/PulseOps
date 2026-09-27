#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd "${script_dir}/../.." && pwd)
terraform_dir="${project_dir}/infra/terraform"
public_ip=$(terraform -chdir="${terraform_dir}" output -raw public_ip)
ssh_key=$(terraform -chdir="${terraform_dir}" output -raw ssh_private_key_path)

ssh -i "${ssh_key}" -o StrictHostKeyChecking=accept-new "ubuntu@${public_ip}" \
  "sudo k3s kubectl get nodes && sudo k3s kubectl -n pulseops get pods,services,pvc"
