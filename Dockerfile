FROM node:18

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y netcat-openbsd curl

COPY package*.json ./
RUN npm install

COPY . .

RUN chmod +x ./wait-for-it.sh

EXPOSE 3000
CMD ["npm", "start"]