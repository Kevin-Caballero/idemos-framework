# IDemos — Framework

TFG de Ingeniería Informática · Kevin Caballero

---

## Required versions

### Runtime & tooling

| Tool       | Version |
| ---------- | ------- |
| Node.js    | >= 20.0 |
| npm        | >= 10.0 |
| Docker     | >= 24.0 |
| TypeScript | ^5.7.x  |

### Backend services (NestJS)

| Package                 | Version |
| ----------------------- | ------- |
| `@nestjs/core`          | ^11.0.1 |
| `@nestjs/common`        | ^11.0.1 |
| `@nestjs/microservices` | ^11.0.1 |
| `@nestjs/config`        | ^4.0.2  |
| `@nestjs/jwt`           | ^11.0.0 |
| `@nestjs/typeorm`       | ^11.0.0 |
| TypeORM                 | ^0.3.20 |
| RxJS                    | ^7.8.1  |

### Mobile app (React Native / Expo)

| Package                      | Version  |
| ---------------------------- | -------- |
| React                        | 19.1.0   |
| React Native                 | 0.81.5   |
| Expo                         | ~54.0.34 |
| Expo Router                  | ~6.0.23  |
| NativeWind                   | ^4.2.1   |
| React Native Reanimated      | ~4.1.1   |
| React Native Gesture Handler | ~2.28.0  |
| TanStack React Query         | ^5.74.4  |
| Zustand                      | ^5.0.3   |
| Tailwind CSS                 | ^3.4.17  |

---

## Database

The project uses **PostgreSQL** managed via Docker and **TypeORM migrations** located in `packages/migrations`.

### Available commands

| Command              | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `npm run db:up`      | Starts PostgreSQL (Docker), waits for it, and applies all pending migrations       |
| `npm run db:down`    | Stops PostgreSQL. Optionally removes volumes (all data will be lost)               |
| `npm run db:seed`    | Runs seed scripts to populate the database with initial data                       |
| `npm run db:prepare` | Installs migration dependencies and prints the command to generate a new migration |

### Creating a new migration

Run this when you change an entity and need to reflect it in the database:

```bash
# 1. Prepare the migrations package (only needed once, or after a fresh clone)
npm run db:prepare

# 2. Generate a migration from entity changes
npm run --prefix packages/migrations migration:generate -- src/migrations/DescribeName

# 3. Apply the new migration
npm run db:up
```

---

## Architecture notes

### Gateway and the Android emulator

The **gateway** is the only entry point for the mobile app. In production it runs inside Docker (`docker-compose.yml`) alongside the rest of the services.

However, the Android emulator cannot reach Docker containers bound to `localhost` on the host machine. The emulator runs in its own virtual network and maps `10.0.2.2` to the host's loopback — but Docker's internal bridge network sits behind an additional layer that makes this routing unreliable.

To work around this, **in development the gateway runs directly on the host** (via `npm run start:dev`), not inside Docker. This way the emulator can reach it at `10.0.2.2:<GATEWAY_PORT>`.

The rest of the backend services (auth, backend, etl, ai) communicate through RabbitMQ, which runs in Docker, and are not directly exposed to the app, so they are not affected by this limitation.

---

## Development

```bash
# 0. Install dependencies (only needed once, or after a fresh clone)
npm i

# 1. Clone all service repos
npm run pull

# 2. Install all dependencies
npm run prepare

# 3. Start infrastructure (PostgreSQL + RabbitMQ) and all services in watch mode
npm run dev
```

The `dev` script starts Docker infrastructure automatically and launches each NestJS service with hot-reload.

To run the mobile app separately:

```bash
cd services/app

# Android (emulator or physical device)
npm run emulator
npm run mobile

# iOS
npm run ios

# Web
npm run web
```
