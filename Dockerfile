FROM node:lts-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 9090
VOLUME ["/mnt"]

CMD ["node", "index.js"]