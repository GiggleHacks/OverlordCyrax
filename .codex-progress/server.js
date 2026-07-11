const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
http
  .createServer((request, response) => {
    const pathname = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\//, "");
    fs.readFile(path.join(root, pathname), (error, body) => {
      if (error) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": pathname.endsWith(".json") ? "application/json" : "text/html; charset=utf-8",
      });
      response.end(body);
    });
  })
  .listen(8333, "127.0.0.1");
