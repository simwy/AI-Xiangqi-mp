FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:h5

FROM node:24-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production
COPY --from=build /app/server ./server
COPY --from=build /app/common ./common
COPY --from=build /app/uniCloud-alipay/cloudfunctions/xiangqi-store/lib ./uniCloud-alipay/cloudfunctions/xiangqi-store/lib
COPY --from=build /app/node_modules/fflate ./node_modules/fflate
COPY --from=build /app/dist/build/h5 ./dist/build/h5
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
EXPOSE 8787
CMD ["node", "server/index.mjs"]
