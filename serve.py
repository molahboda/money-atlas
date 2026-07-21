#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MONEY ATLAS — 로컬 서버

1) 백그라운드에서 update_live.py 를 실행해 최신 시세를 받아오고
2) 이 폴더를 http://127.0.0.1:8741 로 서빙합니다.

사용법: python3 serve.py [포트]
"""
import functools
import http.server
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8741


def refresh_live():
    try:
        sys.path.insert(0, HERE)
        import update_live
        update_live.main()
    except Exception as e:
        print('[live] 시세 갱신 실패(내장 근사치 사용):', e)


threading.Thread(target=refresh_live, daemon=True).start()

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=HERE)
Handler.log_message = lambda *a, **k: None  # 조용히

print('MONEY ATLAS → http://127.0.0.1:%d' % PORT)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
