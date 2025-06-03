# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable for encryption key (recommended)
# ENV ENCRYPTION_KEY="your-super-secret-key-for-token-encryption"
# It's better to pass this at runtime or via docker-compose

# Define environment variable for polling interval (optional)
# ENV POLLING_INTERVAL_MIN=1

# Run app.js when the container launches
CMD [ "node", "app.js" ]
