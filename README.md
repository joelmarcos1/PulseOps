# PulseOps

PulseOps será una pequeña plataforma de monitorización HTTP. Permitirá registrar
URLs, comprobarlas periódicamente y consultar su estado y latencia.

La aplicación se está construyendo con JavaScript, Node.js y Express. Consulta
[la guía paso a paso](docs/guia-paso-a-paso.md) para entender las decisiones,
los archivos y los comandos del proyecto.

## Estado

- [x] Base de la API con `GET /health` y una prueba automatizada.
- [x] Registro y consulta de monitores.
- [x] Persistencia de monitores y resultados en PostgreSQL.
- [x] Worker de comprobaciones periódicas.
- [x] Entorno completo con API, worker y PostgreSQL en Docker Compose.
- [ ] Infraestructura AWS con Terraform y despliegue en k3s.
- [ ] CI y publicación de imágenes con GitHub Actions.

## Requisitos actuales

- Node.js 20 o posterior.
- npm.
- Docker.
- Docker Compose 2.

## Preparación

```bash
npm install
cp .env.example .env
```

`npm install` solo es necesario para desarrollar y ejecutar pruebas fuera de
Docker. Compose instala las dependencias dentro de la imagen.

## Entorno completo con Docker Compose

Construir la imagen y levantar API, worker y PostgreSQL:

```bash
docker compose up --build --detach
```

Consultar el estado:

```bash
docker compose ps
```

Seguir los logs:

```bash
docker compose logs --follow api worker database
```

La API queda disponible en `http://127.0.0.1:8080`. PostgreSQL se publica solo
en `127.0.0.1:5432` y los tres servicios también se comunican mediante la red
privada de Compose.

## Ejecutar las pruebas

```bash
npm test
```

## Ejecutar fuera de Docker durante el desarrollo

Modo normal:

```bash
npm start
```

Modo desarrollo, reiniciando el servidor al guardar cambios:

```bash
npm run dev
```

La API queda disponible en `http://localhost:8080`. Para comprobarla:

```bash
curl http://localhost:8080/health
```

Respuesta esperada:

```json
{"status":"ok"}
```

El worker se puede ejecutar en otra terminal:

```bash
npm run worker
```

El worker comprueba inmediatamente todos los monitores activos, guarda los
resultados y espera 30 segundos antes de la siguiente ronda. Se detiene con
`Ctrl+C`.

## Registrar y consultar monitores

Mientras la API está ejecutándose, se puede registrar un monitor con:

```bash
curl -i -X POST http://localhost:8080/monitors \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example","url":"https://example.com"}'
```

Para consultar los monitores registrados:

```bash
curl -i http://localhost:8080/monitors
```

`GET /monitors` incluye en `latestCheck` el último resultado guardado por el
worker. Los datos permanecen después de reiniciar la API porque se encuentran en
el volumen de PostgreSQL.

Por seguridad, solo se pueden registrar dominios incluidos en `ALLOWED_HOSTS`.
Su valor local se configura en `.env` como una lista separada por comas.

Para detener y eliminar los contenedores sin borrar los datos:

```bash
docker compose down
```

El siguiente `docker compose up --detach` recuperará la base desde el volumen.
No utilices `docker compose down --volumes` si quieres conservar los datos.
