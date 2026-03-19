# ☕ Café Adriani API — Backend REST

> API RESTful construida con NestJS y TypeScript para el sistema de gestión de la cafetería Adriani. Incluye manejo de base de datos con Prisma ORM, despliegue en VPS con PM2 y Nginx, y pipeline de CI/CD con GitHub Actions.

🔗 **Frontend:** [coffee-adriani](https://github.com/Eduardo282x/coffee-adriani)

---

## 📋 Descripción

Este repositorio contiene el backend del sistema Café Adriani. Expone una API RESTful que sirve los datos y la lógica de negocio consumida por el frontend en React. Está construido sobre NestJS con arquitectura modular, Prisma como ORM para interactuar con PostgreSQL, y desplegado en producción en un VPS Ubuntu con PM2 y Nginx.

---

## ✨ Funcionalidades principales

- 🍽️ **Gestión de productos y menú** — CRUD completo de ítems, categorías y precios
- 🛒 **Gestión de pedidos** — Creación, actualización de estado y consulta de pedidos
- 👤 **Gestión de usuarios** — Registro, autenticación y control de acceso
- 🗄️ **ORM con Prisma** — Migraciones, esquema tipado y consultas seguras sobre PostgreSQL
- 🔄 **CI/CD automatizado** — Pipeline con GitHub Actions para despliegue continuo al VPS
- 📐 **Arquitectura modular** — Separación por módulos NestJS (productos, pedidos, usuarios, etc.)

---

## 🛠️ Tecnologías utilizadas

| Categoría | Tecnología |
|-----------|------------|
| Framework | NestJS |
| Lenguaje | TypeScript |
| ORM | Prisma |
| Base de datos | PostgreSQL |
| Runtime | Node.js |
| Gestor de procesos | PM2 |
| Servidor web | Nginx (reverse proxy) |
| CI/CD | GitHub Actions |
| Linting / Formato | ESLint + Prettier |

---

## 🚀 Instalación y uso local

### Requisitos previos

- Node.js 18 o superior
- PostgreSQL instalado y corriendo
- npm

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/Eduardo282x/coffee-adriani-api.git
cd coffee-adriani-api

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con la URL de tu base de datos y demás configs
```

### Variables de entorno requeridas

```env
DATABASE_URL="postgresql://usuario:password@localhost:5432/coffee_adriani"
PORT=3000
```

```bash
# 4. Ejecutar migraciones de Prisma
npx prisma migrate deploy

# 5. Generar el cliente de Prisma
npx prisma generate

# 6. Iniciar en modo desarrollo
npm run start:dev
```

La API estará disponible en `http://localhost:3000`

---

## 📁 Estructura del proyecto

```
coffee-adriani-api/
├── .github/
│   └── workflows/        # Pipelines de CI/CD con GitHub Actions
├── prisma/
│   ├── schema.prisma     # Esquema de base de datos y modelos
│   └── migrations/       # Historial de migraciones
├── src/
│   ├── modules/          # Módulos de la aplicación (productos, pedidos, etc.)
│   ├── common/           # Guards, decoradores, interceptores reutilizables
│   ├── prisma/           # Servicio de Prisma compartido
│   └── main.ts           # Punto de entrada de la aplicación
├── .eslintrc.js          # Configuración de ESLint
├── .prettierrc           # Configuración de Prettier
├── nest-cli.json         # Configuración del CLI de NestJS
└── package.json          # Dependencias y scripts
```

---

## ⚙️ Scripts disponibles

```bash
npm run start           # Inicia en modo producción
npm run start:dev       # Inicia en modo desarrollo con hot-reload
npm run start:prod      # Inicia desde la build compilada
npm run build           # Compila TypeScript a JavaScript en /dist
npm run lint            # Ejecuta ESLint
npm run format          # Formatea el código con Prettier
npm run test            # Ejecuta tests unitarios
npm run test:e2e        # Ejecuta tests end-to-end
npm run test:cov        # Genera reporte de cobertura
```

---

## 🗄️ Base de datos con Prisma

```bash
# Crear una nueva migración tras modificar el schema
npx prisma migrate dev --name nombre_de_la_migracion

# Aplicar migraciones en producción
npx prisma migrate deploy

# Abrir Prisma Studio (explorador visual de la BD)
npx prisma studio
```

---

## 🌐 Despliegue en VPS (Contabo)

El proyecto está desplegado en un servidor VPS con **Ubuntu Linux** en Contabo, usando **PM2** para la gestión del proceso Node.js y **Nginx** como reverse proxy.

### Pasos para desplegar

```bash
# 1. En el servidor, clonar o actualizar el repo
git pull origin main

# 2. Instalar dependencias y compilar
npm install
npm run build

# 3. Aplicar migraciones de base de datos
npx prisma migrate deploy

# 4. Iniciar o reiniciar con PM2
pm2 start dist/main.js --name coffee-api
# o si ya está corriendo:
pm2 restart coffee-api
pm2 save
```

### Configuración de Nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### CI/CD con GitHub Actions

El repositorio incluye un workflow en `.github/workflows/` que automatiza el despliegue al VPS cada vez que se hace push a la rama `main`. El pipeline ejecuta el build, las migraciones y reinicia PM2 automáticamente.

---

## 👤 Autor

**Eduardo Rojas**
- GitHub: [@Eduardo282x](https://github.com/Eduardo282x)
- Email: eduardorojas282x@gmail.com

---

## 📄 Licencia

Este proyecto es de uso privado. Todos los derechos reservados © Eduardo Rojas.
