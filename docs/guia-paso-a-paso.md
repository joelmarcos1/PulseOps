# PulseOps: guía paso a paso

Este documento registra qué contiene PulseOps, para qué sirve cada pieza y cómo
se comprobó cada incremento.

## 1. Objetivo del proyecto

PulseOps es una plataforma pequeña de monitorización HTTP. Un usuario puede
registrar una URL y un proceso periódico comprueba si responde, mide su latencia
y almacena el resultado. La información se consulta mediante una API.

El MVP incluye:

- Una API HTTP.
- Un worker que compruebe las URLs.
- PostgreSQL para conservar monitores y resultados.
- Contenedores Docker para el desarrollo local.
- Infraestructura AWS definida con Terraform.
- Un despliegue en k3s.

La automatización CI/CD queda fuera del alcance final.

## 2. Elección de JavaScript, Node.js y Express


Cada nombre representa algo distinto:

- **JavaScript** es el lenguaje del código fuente.
- **Node.js** ejecuta JavaScript fuera del navegador y proporciona funciones de
  sistema, red y archivos.
- **npm** instala las dependencias y ejecuta comandos definidos por el proyecto.
- **Express** es una biblioteca para definir rutas y respuestas HTTP.

Esta elección no impide utilizar PostgreSQL, Docker, Kubernetes, Terraform o
AWS. Esas herramientas pueden desplegar aplicaciones creadas con distintos
lenguajes.

## 3. Primer incremento: endpoint de salud

El primer resultado observable es:

```text
GET /health  ->  200 OK  ->  {"status":"ok"}
```

Este endpoint confirma que el proceso de la API está arrancado y puede responder.
Todavía no comprueba PostgreSQL ni el futuro worker. Empezar por una ruta pequeña
permite validar la instalación, el arranque y las pruebas antes de añadir más
componentes.

## 4. Estructura actual

```text
PulseOps/
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── compose.yaml
├── package.json
├── package-lock.json
├── db/
│   └── init.sql
├── docs/
│   ├── aws-k3s.md
│   └── guia-paso-a-paso.md
├── infra/
│   └── terraform/
├── k8s/
├── scripts/
│   └── aws/
├── src/
│   ├── app.js
│   ├── checkUrl.js
│   ├── config.js
│   ├── database.js
│   ├── monitorRepository.js
│   ├── server.js
│   ├── urlPolicy.js
│   └── worker.js
├── test-support/
│   └── inMemoryMonitorRepository.js
└── test/
    ├── checkUrl.test.js
    ├── health.test.js
    └── monitors.test.js
```

`node_modules/` también existe después de instalar las dependencias, pero no se
incluye en Git porque puede regenerarse con `npm install`.

### `README.md`

Es la entrada principal para una persona que visita el repositorio. Resume el
proyecto, muestra su estado e incluye los comandos mínimos para instalarlo,
probarlo y ejecutarlo.

### `.gitignore`

Indica a Git qué archivos no se deben versionar. Actualmente excluye:

- `node_modules/`, porque contiene dependencias descargadas y regenerables.
- `coverage/`, porque contendrá informes de pruebas generados.
- `.env`, porque podrá contener configuración local o secretos.
- Estados y variables locales de Terraform.
- Archivos `kubeconfig`, que pueden contener credenciales de Kubernetes.

El archivo `package-lock.json` sí debe guardarse en Git: registra las versiones
exactas instaladas para hacer las instalaciones más reproducibles.

### `package.json`

Es el manifiesto del proyecto Node.js. Sus campos principales son:

- `name` y `version`: identifican el proyecto y su versión actual.
- `private: true`: evita publicarlo accidentalmente como paquete en npm.
- `main`: señala el archivo que inicia el servidor.
- `engines`: documenta que se requiere Node.js 20 o posterior.
- `dependencies`: declara Express y el cliente PostgreSQL `pg` como dependencias
  necesarias en ejecución.
- `scripts`: asigna nombres breves a comandos habituales.

Los scripts actuales son:

```json
"start": "node --env-file-if-exists=.env src/server.js"
"dev": "node --env-file-if-exists=.env --watch src/server.js"
"worker": "node --env-file-if-exists=.env src/worker.js"
"test": "node --test"
```

`npm start` inicia normalmente la API. `npm run dev` utiliza el modo de
observación de Node y reinicia el proceso cuando se guarda un cambio. `npm test`
ejecuta las pruebas con el módulo integrado `node:test`. `npm run worker` inicia
el proceso de comprobaciones. `--env-file-if-exists=.env` hace que Node cargue
la configuración local si el archivo existe, sin fallar si todavía no se creó.

### `package-lock.json`

npm genera este archivo durante `npm install`. Incluye las versiones exactas de
Express y sus dependencias indirectas. No debe editarse manualmente.

### `src/app.js`

Este archivo contiene la función que construye y configura la aplicación Express.
Actualmente recibe dos dependencias:

```javascript
const express = require('express');

function createApp({ monitorRepository, allowedHosts }) {
  const app = express();
  // Rutas de la aplicación...
  return app;
}
```

`monitorRepository` sabe crear y consultar monitores; `allowedHosts` contiene
los destinos permitidos. La API no necesita conocer si el repositorio utiliza
PostgreSQL o memoria. El servidor real le proporciona PostgreSQL y las pruebas
le proporcionan un repositorio temporal, evitando modificar datos reales.

```javascript
app.use(express.json());
```

Este middleware interpreta los cuerpos enviados con formato JSON y deja el
objeto resultante disponible en `req.body`. `POST /monitors` lo utiliza para leer
`req.body.name` y `req.body.url`.

La ruta de salud es:

```javascript
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

- `app.get` registra una ruta para el método HTTP GET.
- `/health` es el camino de la petición.
- `req` representa la petición recibida.
- `res` permite construir la respuesta.
- `status(200)` selecciona el código HTTP que significa operación correcta.
- `json(...)` serializa el objeto JavaScript y envía JSON al cliente.

Finalmente:

```javascript
module.exports = createApp;
```

exporta la función para que tanto el servidor real como las pruebas puedan crear
su propia aplicación.

### `src/server.js`

Este archivo es responsable de abrir el puerto de red:

```javascript
const pool = createDatabasePool(config.databaseUrl);
await pool.query('SELECT 1');
const monitorRepository = createMonitorRepository(pool);
const app = createApp({ monitorRepository, allowedHosts: config.allowedHosts });
```

Antes de abrir el puerto, `SELECT 1` confirma que PostgreSQL está accesible. Si
la conexión falla, la API termina con un mensaje claro en vez de arrancar en un
estado incompleto.

```javascript
app.listen(port, () => {
  console.log(`PulseOps API listening at http://localhost:${port}`);
});
```

`listen` deja el proceso esperando conexiones. Separar este código de `app.js`
permite que las pruebas importen la aplicación sin abrir siempre el puerto 8080.

### Archivos dentro de `test/`

La prueba utiliza módulos incluidos en Node.js, por lo que no necesita una
biblioteca de pruebas adicional:

- `node:test` organiza y ejecuta la prueba.
- `node:assert/strict` compara los resultados reales con los esperados.
- `node:events` permite esperar hasta que el servidor esté escuchando.
- `fetch` envía una petición HTTP; está incorporado en Node.js 20.

Durante la prueba se llama a `app.listen(0)`. El puerto `0` no es un puerto real:
solicita al sistema operativo que elija uno disponible, evitando conflictos con
otros programas. La prueba espera el arranque, solicita `/health`, comprueba el
código `200` y el JSON, y finalmente cierra el servidor aunque falle una
comprobación.

## 5. Instalación y comprobación

Desde la raíz del proyecto:

```bash
npm install
```

npm lee `package.json`, descarga Express dentro de `node_modules/` y crea o
actualiza `package-lock.json`.

Para ejecutar la prueba:

```bash
npm test
```

El resultado debe indicar una prueba superada y ninguna fallida.

Para arrancar la API:

```bash
npm run dev
```

En otra terminal se puede comprobar con:

```bash
curl http://localhost:8080/health
```

La respuesta esperada es:

```json
{"status":"ok"}
```

Para detener el servidor se pulsa `Ctrl+C` en la terminal donde está ejecutándose.

### Resultado verificado el 25 de septiembre de 2026

La instalación terminó con 69 paquetes auditados y ninguna vulnerabilidad
detectada por npm. La prueba produjo este resumen:

```text
tests 1
pass 1
fail 0
```

También se arrancó la API con `npm start` y se hizo una petición real con `curl`.
El servidor respondió con `HTTP/1.1 200 OK` y el cuerpo `{"status":"ok"}`. Después
se detuvo el proceso con `Ctrl+C`.

## 6. Segundo incremento: registro y consulta de monitores en memoria

Este incremento incorpora dos rutas:

```text
POST /monitors  -> registra un monitor
GET /monitors   -> devuelve los monitores registrados
```

Los monitores se guardan por ahora en el array `monitors` creado dentro de
`createApp()`. Un array es una lista de JavaScript mantenida en la memoria del
proceso Node.js. Recargar el navegador no reinicia ese proceso, así que los datos
continúan disponibles. Detener y volver a arrancar Node crea un array nuevo y los
datos desaparecen. Esta implementación es deliberadamente temporal; PostgreSQL
aportará persistencia en el siguiente incremento.

### Cómo funciona `POST /monitors`

El cliente envía un cuerpo JSON como este:

```json
{
  "name": "Example",
  "url": "https://example.com"
}
```

Gracias a `express.json()`, Express transforma ese JSON en `req.body`. La ruta
quita espacios al principio y al final de `name` y `url`, y valida lo siguiente:

1. El nombre debe ser texto y contener entre 1 y 100 caracteres.
2. La URL debe ser texto y contener entre 1 y 2048 caracteres.
3. `new URL(rawUrl)` debe poder interpretar la dirección.
4. El protocolo debe ser `http:` o `https:`.
5. La URL no puede incluir usuario ni contraseña.
6. La URL normalizada no puede estar ya en el array.

`new URL(...)` es una clase incluida en Node.js. Además de validar, normaliza la
dirección; por eso `https://example.com` se almacena como
`https://example.com/`.

Si los datos son válidos, se crea este objeto:

```json
{
  "id": 1,
  "name": "Example",
  "url": "https://example.com/",
  "enabled": true,
  "createdAt": "2026-09-26T07:35:55.326Z",
  "latestCheck": null
}
```

- `id` usa el contador `nextMonitorId`, que aumenta después de cada creación.
- `enabled` comienza en `true` porque el futuro worker deberá comprobarlo.
- `createdAt` se genera en el servidor en formato ISO 8601 y zona UTC.
- `latestCheck` es `null` porque todavía no existe ningún worker que compruebe
  la URL.

El objeto se añade al array con `monitors.push(monitor)`. La respuesta incluye:

- Código `201 Created`, porque se creó un recurso.
- Cabecera `Location: /monitors/1`, que identifica la ruta del nuevo recurso.
- El monitor creado en formato JSON.

Cuando la URL ya existe se devuelve `409 Conflict`. Los datos incorrectos
producen `400 Bad Request`. Los errores mantienen una estructura consistente:

```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "URL must use HTTP or HTTPS"
  }
}
```

### Cómo funciona `GET /monitors`

Esta ruta no necesita cuerpo. Responde con código `200 OK` y el contenido actual
del array:

```json
{
  "monitors": []
}
```

Después de registrar un monitor, el array de la respuesta lo contendrá. Usamos
un objeto con la propiedad `monitors` en lugar de devolver directamente `[]`
para poder añadir en el futuro metadatos como paginación sin cambiar la forma
principal de la respuesta.

### Pruebas añadidas

`test/monitors.test.js` crea una aplicación nueva para cada prueba y comprueba:

- Que la lista comienza vacía.
- Que un monitor válido devuelve `201` y después aparece en la lista.
- Que el nombre vacío devuelve `400`.
- Que un protocolo distinto de HTTP o HTTPS devuelve `400`.
- Que registrar dos veces la misma URL devuelve `409`.

La función auxiliar `startTestServer(t)` abre un puerto temporal, devuelve su URL
y registra el cierre automático del servidor al terminar la prueba.

### Comprobación manual

Primero se arranca la API:

```bash
npm start
```

En otra terminal se registra un monitor:

```bash
curl -i -X POST http://localhost:8080/monitors \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example","url":"https://example.com"}'
```

Después se consulta:

```bash
curl -i http://localhost:8080/monitors
```

El 26 de septiembre de 2026 se verificó manualmente que la creación respondió
`201 Created`, incluyó `Location: /monitors/1` y que la consulta posterior
devolvió el monitor. También se ejecutaron todas las pruebas automáticamente con
este resultado:

```text
tests 6
pass 6
fail 0
```

## 7. Tercer incremento: persistencia con PostgreSQL

El array del segundo incremento se sustituyó por PostgreSQL. La API conserva el
mismo contrato HTTP; únicamente cambió el lugar donde guarda y consulta datos.

```text
Antes:   API -> array en memoria
Ahora:   API -> monitorRepository -> PostgreSQL
```

### `compose.yaml`

Define el servicio `database` utilizando `postgres:16-alpine`. Sus elementos
principales son:

- Variables `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD` para crear la
  base y el usuario local.
- Publicación `127.0.0.1:5432:5432`: PostgreSQL solo se expone en la interfaz
  local, no en todas las interfaces de red.
- Volumen `postgres_data`: conserva los archivos de la base aunque el contenedor
  se detenga o se vuelva a crear.
- Montaje de `db/init.sql`: crea el esquema la primera vez que se inicializa un
  volumen vacío.
- `healthcheck`: ejecuta `pg_isready` para indicar cuándo acepta conexiones.

En este incremento inicial todavía no estaba instalado Docker Compose y se
validó PostgreSQL mediante un contenedor creado con `docker run`. En el hito de
Compose se instaló el complemento y ese contenedor temporal fue sustituido por
los servicios declarados en `compose.yaml`, reutilizando el mismo volumen.

### `db/init.sql`

Crea dos tablas. `monitors` almacena la configuración:

```text
monitors
├── id            BIGSERIAL, clave primaria
├── name          VARCHAR(100), obligatorio
├── url           VARCHAR(2048), obligatorio y único
├── enabled       BOOLEAN, true por defecto
└── created_at    TIMESTAMPTZ, fecha UTC del servidor
```

`BIGSERIAL` genera identificadores numéricos automáticamente. `UNIQUE` hace que
PostgreSQL impida URLs repetidas incluso si dos peticiones llegan simultáneamente.
`TIMESTAMPTZ` representa un instante incluyendo información de zona horaria.

La segunda tabla conserva cada comprobación:

```text
check_results
├── id
├── monitor_id
├── status
├── http_status
├── latency_ms
├── error_type
├── error_message
└── checked_at
```

`monitor_id` es una clave externa que relaciona el resultado con `monitors.id`.
`ON DELETE CASCADE` significa que, si algún día se elimina un monitor, también
se eliminan sus resultados. La restricción `CHECK` solo admite `UP` y `DOWN`.
El índice por `monitor_id` y `checked_at DESC` acelera la búsqueda del último
resultado de cada monitor.

### `.env.example` y `src/config.js`

`.env.example` documenta las variables necesarias sin contener secretos reales.
Cada desarrollador puede copiarlo:

```bash
cp .env.example .env
```

`.env` está ignorado por Git. `config.js` lee `process.env`, aplica valores
locales predeterminados y comprueba que puertos, intervalos y timeouts sean
enteros positivos.

Las variables actuales son:

- `DATABASE_URL`: conexión completa a PostgreSQL.
- `PORT`: puerto HTTP de la API; por defecto 8080.
- `CHECK_INTERVAL_MS`: espera entre rondas; por defecto 30000 ms.
- `REQUEST_TIMEOUT_MS`: máximo por petición; por defecto 5000 ms.
- `ALLOWED_HOSTS`: nombres de host separados por comas; por defecto
  `example.com`.

### `src/database.js`

Utiliza la nueva dependencia `pg` para crear un `Pool`. Un pool mantiene y
reutiliza conexiones a PostgreSQL, evitando abrir una conexión TCP nueva para
cada consulta.

### `src/monitorRepository.js`

Centraliza las operaciones SQL:

- `create`: inserta un monitor.
- `list`: consulta monitores y el último resultado de cada uno.
- `listEnabled`: obtiene los monitores que debe procesar el worker.
- `saveCheckResult`: inserta el resultado de una comprobación.

Las consultas usan parámetros `$1`, `$2`, etc. y envían los valores en un array.
Esto evita concatenar texto proporcionado por el usuario y protege frente a
inyecciones SQL.

`list` usa `LEFT JOIN LATERAL` para buscar, para cada monitor, como máximo una
fila de `check_results`: la más reciente. Si todavía no hay resultados,
`latestCheck` se convierte en `null`.

Las columnas SQL utilizan `snake_case`, por ejemplo `created_at`. La función
`mapMonitor` las convierte a la respuesta JavaScript en `camelCase`, como
`createdAt`.

### Cambios en la API

`POST /monitors` llama ahora a `monitorRepository.create`. Si PostgreSQL devuelve
el código `23505`, significa que la restricción `UNIQUE` detectó un duplicado y
la API lo transforma en `409 Conflict`.

`GET /monitors` llama a `monitorRepository.list`. Un manejador de errores final
devuelve un JSON estable con código `500` si aparece un fallo inesperado.

`server.js` comprueba primero la conexión, construye el repositorio y se lo pasa
a `createApp`. Al recibir `Ctrl+C`, cierra el servidor y el pool de conexiones.

### Persistencia verificada

El 26 de septiembre de 2026 se creó un monitor, se detuvo la API, se arrancó de
nuevo y `GET /monitors` devolvió el mismo registro y sus resultados. Esto prueba
que los datos ya no dependen de la memoria de Node.js.

## 8. Cuarto incremento: worker de comprobaciones

La API responde a peticiones de clientes. El worker, en cambio, es un proceso
independiente que trabaja periódicamente aunque ningún usuario esté haciendo una
petición.

Se inicia con:

```bash
npm run worker
```

### `src/urlPolicy.js`

Centraliza la validación de URLs para que API y worker apliquen la misma regla.
Solo admite HTTP y HTTPS, rechaza credenciales y exige que el hostname aparezca
exactamente en `ALLOWED_HOSTS`.

La API valida antes de guardar. El worker vuelve a validar antes de hacer una
petición: esta segunda comprobación protege frente a datos antiguos o insertados
directamente en la base.

Para reducir el riesgo de redirecciones hacia redes internas, el worker usa
`redirect: 'manual'`: registra la respuesta `3xx`, pero no sigue automáticamente
su destino. La lista permitida es una protección sencilla para el laboratorio;
una aplicación pública necesitaría controles SSRF adicionales.

### `src/checkUrl.js`

Comprueba una única dirección mediante el `fetch` incluido en Node.js 20:

1. Guarda el instante inicial con `performance.now()`.
2. Envía una petición GET.
3. `AbortSignal.timeout` cancela la espera al superar el límite.
4. Calcula milisegundos hasta recibir las cabeceras HTTP.
5. Cancela el cuerpo porque PulseOps no necesita descargar la página completa.
6. Devuelve un objeto que el repositorio puede guardar.

Clasificación implementada:

```text
HTTP 200-399  -> UP, conserva código y latencia
HTTP 400-599  -> DOWN, conserva código y latencia
Timeout       -> DOWN, httpStatus null, errorType TIMEOUT
Error de red  -> DOWN, httpStatus null, errorType NETWORK
```

Así se distingue una respuesta HTTP negativa de la ausencia completa de
respuesta.

### `src/worker.js`

Al arrancar, verifica PostgreSQL con `SELECT 1`. Después ejecuta rondas:

1. Lee los monitores con `enabled = true`.
2. Los recorre uno por uno mediante `for...of`.
3. Valida otra vez cada URL.
4. Ejecuta `checkUrl`.
5. Inserta el resultado en `check_results`.
6. Espera `CHECK_INTERVAL_MS`.
7. Empieza la siguiente ronda.

La ejecución secuencial es suficiente para el MVP y evita solapamientos. Si una
ronda tarda mucho, la espera comienza después de terminarla. `Ctrl+C` cancela
también la espera activa, cierra el pool y detiene el proceso limpiamente.

### Pruebas sin tocar PostgreSQL real

`test-support/inMemoryMonitorRepository.js` implementa las operaciones que la
API necesita utilizando un array. Solo lo usan las pruebas. Este patrón de pasar
una dependencia desde fuera permite probar las rutas sin borrar ni contaminar la
base de desarrollo.

`test/checkUrl.test.js` sustituye temporalmente `fetch` por funciones controladas
que simulan HTTP 204, HTTP 503, timeout y error de red. No depende de Internet.

El resultado actual es:

```text
tests 11
pass 11
fail 0
```

### Prueba real de extremo a extremo

Se utilizó un servidor HTTP local temporal con dos rutas. Con
`ALLOWED_HOSTS=example.com,127.0.0.1`, el resultado observado fue:

```text
/up    -> HTTP 204 -> UP, latencia guardada
/down  -> HTTP 503 -> DOWN, latencia guardada
```

`example.com` produjo `DOWN` con error de red o timeout porque el entorno de
ejecución no pudo resolver su DNS. `curl` confirmó la misma limitación, por lo
que la clasificación del worker fue correcta. Todos los monitores y resultados
creados para esta prueba se eliminaron al terminar; la base quedó vacía para que
el usuario pueda repetir la demostración desde el principio.

## 9. Quinto incremento: entorno completo con Docker Compose

Este hito empaqueta la aplicación y coordina los tres procesos:

```text
Docker Compose
├── api       -> imagen pulseops:local, puerto 8080
├── worker    -> misma imagen, otro comando
└── database  -> imagen postgres:16-alpine, puerto 5432
```

### Instalación de Docker Compose

Ubuntu ofrecía `docker-compose-v2` 2.40.3, pero la instalación del sistema
requería una contraseña de `sudo`. Se descargó ese mismo paquete de Ubuntu y se
instaló el ejecutable para el usuario en:

```text
~/.docker/cli-plugins/docker-compose
```

Así `docker compose` funciona sin modificar los paquetes globales del sistema.
La instalación se comprobó con `docker compose version`.

### `Dockerfile`

Una imagen es una plantilla inmutable con el sistema base, las dependencias y el
código. El archivo contiene:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src/ ./src/
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
```

- `FROM` parte de una imagen pequeña con Node.js 20.
- `WORKDIR` establece `/app` como carpeta de trabajo dentro de la imagen.
- Primero se copian los manifiestos para que Docker pueda reutilizar la capa de
  dependencias cuando solo cambia el código.
- `npm ci` instala exactamente las versiones de `package-lock.json`.
- `--omit=dev` excluye dependencias que solo sean necesarias para desarrollar.
- Después se copia `src/`, propiedad del usuario `node`.
- `USER node` evita ejecutar la aplicación como `root` dentro del contenedor.
- `EXPOSE 8080` documenta el puerto de la API.
- `CMD` es el comando predeterminado; Compose puede sustituirlo para el worker.

API y worker reutilizan la misma imagen porque tienen el mismo código y las
mismas dependencias. Solo cambia el comando:

```text
api     -> node src/server.js
worker  -> node src/worker.js
```

### `.dockerignore`

Reduce el contexto enviado a Docker. Excluye `node_modules`, `.env`, pruebas,
documentación y otros archivos que la aplicación no necesita en ejecución. Es
especialmente importante excluir `.env` para no copiar secretos dentro de la
imagen.

### Servicio `database`

Usa `postgres:16-alpine`, monta `db/init.sql`, conserva datos en el volumen
`pulseops_postgres_data` y publica el puerto únicamente en
`127.0.0.1:5432`. Su healthcheck usa `pg_isready`.

El nombre explícito del volumen permitió reutilizar inicialmente el que ya se
había creado durante el hito anterior y comprobar la persistencia. Después de
vaciar los datos de demostración, se eliminó aquel volumen vacío y Compose lo
creó de nuevo con sus propias etiquetas. El antiguo contenedor
`pulseops-postgres` también se eliminó; ahora todo el entorno queda administrado
por Compose.

### Servicio `api`

Construye `pulseops:local`, ejecuta `node src/server.js` y recibe esta conexión:

```text
postgresql://pulseops:pulseops@database:5432/pulseops
```

Dentro de una red Compose, `localhost` significaría el propio contenedor de la
API. El nombre `database` es resuelto por el DNS interno de Docker hacia el
contenedor PostgreSQL.

`depends_on` con `condition: service_healthy` retrasa el arranque hasta que la
base acepte conexiones. El puerto se publica como
`127.0.0.1:8080:8080`, por lo que el navegador del host puede acceder a la API,
pero no se expone en todas las interfaces.

`restart: on-failure:5` permite hasta cinco reintentos si durante el arranque se
produce un fallo transitorio de red o de resolución DNS.

El healthcheck de la API ejecuta una petición a `/health` desde el propio
contenedor mediante el `fetch` de Node.js.

### Servicio `worker`

Reutiliza `pulseops:local` sin construir otra imagen y sustituye el comando por
`node src/worker.js`. Comparte con API la conexión a PostgreSQL, el timeout y la
lista de hosts permitidos. No publica puertos porque nadie necesita iniciar una
conexión hacia el worker. También dispone de hasta cinco reintentos ante un fallo
transitorio de arranque.

### Red interna

Compose crea automáticamente `pulseops_default`:

```text
api ─────────┐
             ├── pulseops_default ── database
worker ──────┘
```

Los servicios se encuentran por nombre: `api`, `worker` y `database`. Se añadió
`api` a `ALLOWED_HOSTS` para poder realizar una demostración controlada
monitorizando `http://api:8080/health` desde el worker.

### Comandos operativos

Construir y levantar en segundo plano:

```bash
docker compose up --build --detach
```

Consultar estados y healthchecks:

```bash
docker compose ps
```

Consultar o seguir logs:

```bash
docker compose logs --tail 50
docker compose logs --follow api worker database
```

Reconstruir después de cambiar código o dependencias:

```bash
docker compose up --build --detach
```

Detener y eliminar contenedores y red, conservando los datos:

```bash
docker compose down
```

No se debe añadir `--volumes` si se quieren conservar los monitores y resultados.

### Evidencias verificadas el 27 de septiembre de 2026

Se construyó `pulseops:local` y los tres servicios quedaron activos. Los
healthchecks de API y PostgreSQL mostraron `healthy`.

Se registró temporalmente:

```text
http://api:8080/health
```

El worker resolvió `api` dentro de la red privada, recibió HTTP 200, clasificó
el monitor como `UP` y guardó una latencia de 21 ms.

Después se ejecutó `docker compose down` y `docker compose up --detach`. El
monitor y su resultado continuaron en PostgreSQL, demostrando que el volumen es
persistente. Durante el arranque simultáneo el worker realizó una comprobación
antes de que la API estuviera lista y registró temporalmente `DOWN/NETWORK`; la
siguiente ronda lo devolvió correctamente a `UP`. Esta independencia es
intencional: el worker no debe depender de que la API esté disponible.

Al terminar se eliminaron los datos de demostración y se reiniciaron las
secuencias. La base quedó con cero monitores y cero resultados.

## 10. Estado del entorno local

API, worker y PostgreSQL se verificaron conjuntamente mediante Docker Compose.

## 11. Infraestructura AWS y k3s

Se ha añadido la definición de la red y EC2 con Terraform, los manifiestos de
Kubernetes y los scripts de despliegue manual. La explicación completa, el coste,
los comandos de creación, las comprobaciones y la destrucción están en
[`docs/aws-k3s.md`](aws-k3s.md).

La configuración local supera `terraform validate`, los siete objetos de
Kubernetes superan la validación de esquema para Kubernetes 1.36, las once
pruebas Node.js pasan y la imagen `pulseops:manual` se construye correctamente.

Todavía no se ha ejecutado `terraform apply`: falta iniciar sesión en AWS,
revisar el plan real y aprobar de forma explícita el gasto estimado. Hasta ese
momento no existe ningún recurso del proyecto en AWS ni se genera coste.
