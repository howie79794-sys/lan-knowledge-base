ARG NODE_BASE_IMAGE=node:24-alpine
ARG NGINX_BASE_IMAGE=nginx:1.27-alpine
FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com

COPY package.json package-lock.json* ./
RUN npm config set registry "${NPM_REGISTRY}" \
  && npm install

COPY . .
RUN npm run build

FROM ${NGINX_BASE_IMAGE}

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
