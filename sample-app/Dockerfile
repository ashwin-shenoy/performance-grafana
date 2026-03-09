FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Patch @pyroscope/nodejs wall-profiler: args.context?.context.labels crashes
# on Node 18+ when context exists but context.context is undefined.
# Fix: make second .context access also optional.
RUN node -e "var fs=require('fs'),f='node_modules/@pyroscope/nodejs/dist/cjs/profilers/wall-profiler.js',c=fs.readFileSync(f,'utf8');c=c.replace('args.context?.context.labels','args.context?.context?.labels');fs.writeFileSync(f,c);console.log('Patched');"

COPY *.js ./

EXPOSE 3002

CMD ["node", "--require", "./tracing.js", "--require", "./profiling.js", "index.js"]
