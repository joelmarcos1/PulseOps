# PulseOps: infraestructura AWS y despliegue en k3s

Esta guía explica la última parte del proyecto: qué se crea en AWS, cómo se
instala Kubernetes, cómo se despliega PulseOps, cuánto puede costar y cómo se
elimina todo al terminar.

## 1. Estado actual

La definición está escrita y validada localmente, pero todavía no se ha creado
ningún recurso en AWS. El paso `terraform apply` se hará únicamente después de:

1. Iniciar sesión en la cuenta AWS.
2. Ejecutar y revisar `terraform plan`.
3. Confirmar que el coste estimado es aceptable.

Esta separación es importante: escribir, formatear y validar Terraform no crea
recursos ni genera cargos. `terraform apply` sí puede hacerlo.

## 2. Arquitectura elegida

```text
Internet
   │
   │ solo IP del administrador
   │ TCP 22 y TCP 30080
   ▼
VPC 10.20.0.0/16
└── Subred pública 10.20.1.0/24
    └── EC2 t3.medium + 20 GiB gp3 cifrados
        └── k3s, clúster Kubernetes de un nodo
            └── namespace pulseops
                ├── API      ── Service NodePort 30080
                ├── worker   ── sin puerto público
                └── PostgreSQL ── Service interno 5432
                    └── PVC local-path de 5 GiB
```

Se usa un único nodo porque es un laboratorio y buscamos la solución mínima.
k3s es una distribución ligera de Kubernetes: ofrece los objetos que necesitamos
(`Deployment`, `StatefulSet`, `Service`, `Secret`, `ConfigMap` y PVC) con menos
consumo y menos administración que un clúster de varios nodos.

La instancia es `t3.medium`, con 2 vCPU y 4 GiB de memoria. Es más holgada que
el mínimo absoluto de k3s y permite ejecutar al mismo tiempo k3s, PostgreSQL, la
API y el worker. Los créditos de CPU se configuran como `standard` para evitar
cargos por créditos excedentes del modo `unlimited`.

No se crea NAT Gateway, balanceador, Elastic IP, ECR ni una base de datos RDS.
Eso mantiene sencilla la práctica y evita sus costes adicionales. Como no habrá
CI/CD ni registro de imágenes, la imagen se construye localmente y se copia al
nodo de forma cifrada mediante SSH.

## 3. Coste estimado antes de crear nada

Estimación consultada el 27 de septiembre de 2026 para `eu-south-2` (España),
suponiendo 730 horas de uso al mes:

| Recurso | Precio usado | Aproximación mensual |
|---|---:|---:|
| EC2 `t3.medium` Linux bajo demanda | 0,0456 USD/h | 33,29 USD |
| Volumen raíz gp3 de 20 GiB | 0,088 USD/GiB-mes | 1,76 USD |
| IPv4 pública en uso | 0,005 USD/h | 3,65 USD |
| **Total base** | | **38,70 USD/mes** |

La aproximación es de 1,27 USD por día o 5,09 USD por cuatro días. No incluye
impuestos, transferencia de datos, cambios futuros de precio ni recursos que se
creen manualmente fuera de Terraform. Los créditos o la capa gratuita de una
cuenta concreta pueden reducir el cargo, pero no se presuponen.

Fuentes de referencia:

- [Catálogo oficial de precios de EC2 para eu-south-2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/eu-south-2/index.json).
- [Precio oficial de IPv4 pública de Amazon VPC](https://aws.amazon.com/vpc/pricing/).
- [Requisitos oficiales de k3s](https://docs.k3s.io/installation/requirements).

El coste continúa mientras la instancia y su disco existan. En este diseño,
detener EC2 evita el cómputo y libera su IPv4 pública dinámica, pero el disco
continúa generando cargos. Para terminar la práctica se debe ejecutar la
destrucción de la sección 10 y comprobar que no queden recursos.

## 4. Medidas de seguridad

- SSH (`22`) y la API (`30080`) solo aceptan tráfico desde una única IPv4
  indicada como `/32` en `admin_cidr`.
- El puerto de administración de Kubernetes (`6443`) no se publica en AWS. Los
  comandos de k3s se ejecutan dentro de EC2 a través de SSH.
- PostgreSQL usa un `Service` interno y no tiene puerto público ni NodePort.
- El disco gp3 está cifrado.
- EC2 exige IMDSv2 para consultar sus metadatos.
- La clave privada SSH vive en `~/.ssh/pulseops_ed25519`, fuera del repositorio.
  AWS recibe solamente `pulseops_ed25519.pub`.
- La contraseña de PostgreSQL no aparece en Git ni en Terraform. Se pasa al
  script mediante una variable de entorno y se crea como `Secret` de Kubernetes.
- `.gitignore` excluye `terraform.tfvars`, estados, planes y kubeconfigs.
- `.dockerignore` impide enviar `infra/`, `k8s/` y `scripts/` al construir la
  imagen de la aplicación.

Un `Secret` normal de Kubernetes está codificado en base64, no cifrado por sí
mismo dentro del datastore de k3s. Esto es aceptable para el laboratorio, pero
en producción se usaría cifrado de secretos en reposo o un gestor externo.

## 5. Archivos de Terraform

Terraform describe la infraestructura deseada. Compara esos archivos con el
estado conocido y calcula qué debe crear, modificar o destruir.

### `infra/terraform/versions.tf`

Fija Terraform `1.16.x` y el proveedor AWS `6.x`. El proveedor es el componente
que traduce los recursos `.tf` en llamadas a la API de AWS. También añade a los
recursos compatibles las etiquetas `Project=pulseops` y
`ManagedBy=Terraform`, útiles para identificarlos y revisar costes.

### `infra/terraform/variables.tf`

Declara los valores configurables:

- Región: `eu-south-2`.
- Tipo de instancia: `t3.medium`.
- Tamaño del disco: 20 GiB como mínimo.
- Versión fijada de k3s: `v1.36.4+k3s1`.
- Ruta de la clave pública SSH.
- IP administradora, que debe ser un CIDR de una sola dirección terminado en
  `/32`. Esta validación evita abrir accidentalmente el acceso a todo Internet.

### `infra/terraform/terraform.tfvars.example`

Es una plantilla versionada. El archivo real se llama `terraform.tfvars`, se
crea localmente y Git lo ignora. En esta máquina ya contiene la configuración
del laboratorio y la IP pública detectada; antes del plan hay que comprobar si
esa IP ha cambiado.

### `infra/terraform/main.tf`

Crea, en este orden lógico:

1. Busca una imagen oficial y reciente de Ubuntu Server 24.04 x86_64 publicada
   por Canonical.
2. Crea la VPC `10.20.0.0/16`.
3. Crea la subred pública `10.20.1.0/24` en una zona disponible de la región.
4. Conecta un Internet Gateway y una ruta de salida `0.0.0.0/0`.
5. Crea el Security Group con dos entradas restringidas: 22 y 30080.
6. Registra en EC2 la clave pública SSH.
7. Crea la instancia, su IPv4 pública dinámica y su disco gp3 cifrado.
8. Entrega a la instancia el script inicial que instala k3s.

Después de la primera creación se ignoran cambios automáticos en la AMI elegida.
Así, la aparición de una Ubuntu más reciente no reemplaza por sorpresa el nodo
y el disco que contiene la base; una actualización de imagen será una operación
deliberada.

Las redes elegidas no chocan con los rangos predeterminados de pods
(`10.42.0.0/16`) y servicios (`10.43.0.0/16`) de k3s.

### `infra/terraform/cloud-init.sh.tftpl`

EC2 ejecuta esta plantilla una vez durante su primer arranque. Actualiza el
índice de paquetes, instala las herramientas mínimas, descarga el instalador
oficial, instala la versión fijada de k3s y espera a que el nodo responda.

Se desactivan Traefik y ServiceLB porque la API ya se expone mediante NodePort;
mantenerlos consumiría recursos sin aportar nada a este MVP. Al terminar se crea
`/var/lib/pulseops-k3s-ready`, que el script de despliegue usa como señal.

### `infra/terraform/outputs.tf`

Muestra después del `apply` el identificador de EC2, la IP pública, la URL de la
API y el comando SSH. Los scripts leen esos mismos outputs para no duplicar ni
copiar direcciones manualmente.

### `.terraform.lock.hcl`

Lo genera `terraform init` y sí se guarda en Git. Fija la versión y los hashes
del proveedor descargado para que futuras instalaciones sean reproducibles.
La carpeta `.terraform/`, en cambio, contiene binarios descargados y se ignora.

### `terraform.tfstate`

Aparecerá solamente después de crear recursos. Relaciona cada bloque Terraform
con su identificador real en AWS. No se versiona y debe conservarse hasta haber
ejecutado `destroy`; perderlo dificulta eliminar de forma segura la práctica.

## 6. Manifiestos de Kubernetes

### `k8s/namespace.yaml`

Crea el namespace `pulseops`, un espacio lógico que agrupa todos los objetos de
la aplicación y evita mezclarlos con los componentes internos de k3s.

### `k8s/configmap.yaml`

Guarda configuración no secreta:

- comprobación cada 30 segundos;
- timeout HTTP de 5 segundos;
- hosts admitidos: `example.com` y el servicio interno `pulseops-api`.

### `k8s/postgres.yaml`

Contiene dos objetos:

- Un `Service` interno llamado `postgres`, que da a API y worker el nombre DNS
  `postgres` dentro del namespace.
- Un `StatefulSet` de una réplica, apropiado para un proceso con identidad y
  almacenamiento persistente.

PostgreSQL lee usuario, base y contraseña; la contraseña procede del `Secret`.
El esquema de `db/init.sql` se monta durante la primera inicialización. Las
probes `pg_isready` indican a Kubernetes cuándo está listo y si continúa vivo.

El `volumeClaimTemplate` pide 5 GiB a la clase `local-path` incluida en k3s. Los
datos sobreviven al reinicio de un pod, pero permanecen físicamente en el disco
del único EC2: destruir la instancia y su volumen elimina la base.

### `k8s/api.yaml`

El `Deployment` mantiene una réplica de la API. Un `initContainer` espera a que
PostgreSQL acepte conexiones antes de iniciar Node.js. La URL de base de datos
se lee del `Secret` y los hosts permitidos del `ConfigMap`.

Las sondas llaman a `/health`; la readiness evita enviar tráfico antes de que la
API esté lista y la liveness permite reiniciarla si deja de responder. Requests
y limits impiden que el contenedor consuma sin límite la pequeña instancia.

El `Service` es `NodePort`: publica el puerto interno 8080 como 30080 del nodo.
El Security Group de AWS sigue siendo la barrera que solo permite la IP
administradora.

### `k8s/worker.yaml`

Ejecuta la misma imagen que la API, pero sustituye el comando por
`node src/worker.js`. No tiene `Service` ni puerto público porque nadie inicia
peticiones hacia él. Lee de PostgreSQL los monitores activos, comprueba sus URLs
y almacena resultados cada 30 segundos.

## 7. Scripts de operación

### `scripts/aws/deploy.sh`

Automatiza el despliegue sin CI/CD:

1. Exige una contraseña de 16 a 64 caracteres seguros para una URL.
2. Lee de Terraform la IP y la clave SSH.
3. Espera hasta diez minutos a que SSH y k3s estén preparados.
4. Construye localmente `pulseops:manual` para `linux/amd64`, la arquitectura
   de la instancia EC2, con el `Dockerfile` existente.
5. Exporta, comprime y envía la imagen por SSH; k3s la importa en su runtime.
6. Copia los manifiestos y el esquema SQL, que no contienen la contraseña.
7. Crea el `Secret` directamente por la entrada cifrada de SSH.
8. Crea el `ConfigMap` del esquema y aplica los manifiestos en orden.
9. Reinicia controladamente API y worker para usar la imagen recién importada.
10. Espera los rollouts y muestra pods, servicios y PVC finales.

La contraseña solo permanece en la variable de entorno del proceso y en el
`Secret` remoto; no se escribe en un archivo del repositorio.

### `scripts/aws/status.sh`

Se conecta por SSH y muestra el nodo, pods, servicios y volumen. Sirve como una
vista rápida del estado sin exponer el kubeconfig ni el puerto 6443.

## 8. Creación y despliegue, cuando se apruebe

La AWS CLI instalada admite credenciales temporales de consola. El usuario debe
iniciar el flujo en navegador; no se deben pegar contraseñas ni claves en este
repositorio:

```bash
aws login --profile pulseops --region eu-south-2
aws sts get-caller-identity --profile pulseops
```

Después se comprueba la IP pública actual y se actualiza `admin_cidr` si fuera
necesario:

```bash
curl -fsS https://checkip.amazonaws.com
```

Preparar y revisar el plan, sin crear todavía:

```bash
AWS_PROFILE=pulseops terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform validate
AWS_PROFILE=pulseops terraform -chdir=infra/terraform plan -out=pulseops.tfplan
AWS_PROFILE=pulseops terraform -chdir=infra/terraform show pulseops.tfplan
```

Solo después de revisar el plan y confirmar el coste:

```bash
AWS_PROFILE=pulseops terraform -chdir=infra/terraform apply pulseops.tfplan
```

La instalación de k3s se produce durante el primer arranque. Para construir y
desplegar la aplicación:

```bash
export PULSEOPS_DB_PASSWORD="$(openssl rand -hex 24)"
./scripts/aws/deploy.sh
```

La variable desaparece al cerrar la terminal. Si se necesitara redesplegar sin
recrear la base, se debe conservar esa misma contraseña en un gestor seguro y
volver a exportarla; cambiarla solo en Kubernetes no cambia automáticamente la
contraseña que PostgreSQL guardó durante su primera inicialización.

## 9. Comprobaciones funcionales

Consultar los objetos remotos:

```bash
./scripts/aws/status.sh
```

Obtener la URL calculada por Terraform:

```bash
terraform -chdir=infra/terraform output -raw api_url
```

Probar salud, registrar un monitor permitido y consultar el resultado:

```bash
PULSEOPS_URL="$(terraform -chdir=infra/terraform output -raw api_url)"
curl "${PULSEOPS_URL}/health"
curl -X POST "${PULSEOPS_URL}/monitors" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example","url":"https://example.com"}'
curl "${PULSEOPS_URL}/monitors"
```

Tras unos 30 segundos, el último comando debe incluir `latestCheck`. Se deben
probar además dos persistencias diferentes:

1. Reiniciar el pod de PostgreSQL y confirmar que el monitor continúa, porque
   el PVC conserva los datos.
2. Redesplegar la imagen y confirmar que API y worker usan pods nuevos.

Si cambia la IP pública del domicilio, AWS bloqueará correctamente SSH y la API.
Se debe editar `admin_cidr`, generar un nuevo plan y aplicarlo.

## 10. Destrucción y comprobación de residuos

La destrucción borra EC2 y el volumen que contiene PostgreSQL; por tanto, esta
operación elimina definitivamente monitores y resultados del laboratorio.

Primero se revisa un plan de destrucción:

```bash
AWS_PROFILE=pulseops terraform -chdir=infra/terraform plan \
  -destroy -out=destroy.tfplan
AWS_PROFILE=pulseops terraform -chdir=infra/terraform show destroy.tfplan
```

Si la lista es correcta:

```bash
AWS_PROFILE=pulseops terraform -chdir=infra/terraform apply destroy.tfplan
```

Terraform debe terminar indicando `Destroy complete`. Después se comprueba que
no queden recursos etiquetados del proyecto:

```bash
AWS_PROFILE=pulseops aws ec2 describe-instances --region eu-south-2 \
  --filters Name=tag:Project,Values=pulseops \
  --query 'Reservations[].Instances[?State.Name!=`terminated`].[InstanceId,State.Name]'

AWS_PROFILE=pulseops aws ec2 describe-volumes --region eu-south-2 \
  --filters Name=tag:Project,Values=pulseops \
  --query 'Volumes[].[VolumeId,State]'

AWS_PROFILE=pulseops aws ec2 describe-vpcs --region eu-south-2 \
  --filters Name=tag:Project,Values=pulseops \
  --query 'Vpcs[].VpcId'

AWS_PROFILE=pulseops aws ec2 describe-security-groups --region eu-south-2 \
  --filters Name=tag:Project,Values=pulseops \
  --query 'SecurityGroups[].GroupId'
```

Los volúmenes, VPC y grupos deben devolver listas vacías. Una instancia recién
destruida puede seguir apareciendo brevemente con estado `terminated`, pero ya
no factura cómputo. La IPv4 no es elástica y se libera con la instancia.

No se debe borrar el estado de Terraform hasta que estas comprobaciones hayan
terminado. Finalmente se puede cerrar la sesión temporal:

```bash
aws logout --profile pulseops
```

## 11. Límites conscientes del laboratorio

- Un solo nodo no ofrece alta disponibilidad.
- La API usa HTTP, no HTTPS, y está pensada para acceso temporal desde una IP.
- La base no tiene copias de seguridad y desaparece al destruir el volumen.
- La imagen se transfiere manualmente; no hay registro ni CI/CD.
- El estado Terraform es local; en equipo se usaría un backend remoto con
  bloqueo y cifrado.
- No es un diseño de producción. Su objetivo es demostrar infraestructura como
  código, Kubernetes, separación de procesos y persistencia con el mínimo de
  componentes.
