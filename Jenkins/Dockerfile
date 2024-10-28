ARG npmRegistry=
FROM node:20.9.0-bullseye

COPY src /project

RUN npm set registry ${npmRegistry} && \
  cd /project && \
  npm ci

WORKDIR "/project"

CMD ["node", "index.js"]