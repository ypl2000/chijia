#!/usr/bin/env python3
"""chijia v3 静态预览服务器（零后端模式）。

用法：  python serve.py            默认 http://127.0.0.1:8412
        python serve.py --port 9000

只监听 127.0.0.1，不暴露到局域网/公网；页面与脚本全部来自本地 web/ 目录。
需要多设备同步时才改用 backend/app.py（同样建议只监听 127.0.0.1）。
"""
import argparse
import functools
import http.server
import os
import socketserver

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # 零后端模式：明确告知前端「没有同步后端」，避免探测请求产生 404 噪声
        if self.path.split("?")[0].rstrip("/") == "/api/health":
            body = b'{"ok":false,"mode":"local-only"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 不写访问日志：避免把使用痕迹留在磁盘上


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8412)
    a = p.parse_args()
    handler = functools.partial(Handler, directory=ROOT)
    with Server((a.host, a.port), handler) as srv:
        print(f"持家 v3 → http://{a.host}:{a.port}/  (仅本机，Ctrl+C 退出)", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
