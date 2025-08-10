# Use Node.js LTS version
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm install

# Bundle app source
COPY . .

# Create necessary directories
RUN mkdir -p views/emails

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8000

# Expose the port
EXPOSE 8000

# Start the application
CMD [ "node", "server.js" ] 