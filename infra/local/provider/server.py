"""Serialized S3/KMS fixture requests acknowledge only after a durable authenticated snapshot."""
import os
import re
import threading
from werkzeug.serving import make_server, WSGIRequestHandler
from moto.moto_server.werkzeug_app import DomainDispatcherApplication, create_backend_app
from state import Store


class Quiet(WSGIRequestHandler):
    timeout = 10
    def log(self,*args,**kwargs):
        pass


class Provider:
    def __init__(self,store):
        self.store, self.app, self.lock = store, DomainDispatcherApplication(create_backend_app), threading.RLock()
        self.poisoned = False

    def __call__(self,environ,start_response):
        def fail(status):
            start_response(status,[("Content-Type","application/json"),("Cache-Control","no-store")])
            return [b'{"error":"Local fixture provider unavailable"}']
        with self.lock:
            path = environ.get("PATH_INFO","")
            if self.poisoned:
                return fail("503 Service Unavailable")
            if path.startswith("/moto-api") and (path!="/moto-api/" or environ["REQUEST_METHOD"]!="GET"):
                return fail("403 Forbidden")
            target = environ.get("HTTP_X_AMZ_TARGET","")
            auth = environ.get("HTTP_AUTHORIZATION","")
            if target and not target.startswith("TrentService."):
                return fail("403 Forbidden")
            if auth and ("Credential=fixture-access/" not in auth or not re.search(r"/(s3|kms)/aws4_request",auth)):
                return fail("403 Forbidden")
            try:
                length = int(environ.get("CONTENT_LENGTH") or 0)
                if length < 0 or (environ["REQUEST_METHOD"] in ["POST","PUT"] and not environ.get("CONTENT_LENGTH")):
                    return fail("400 Bad Request")
            except ValueError:
                return fail("400 Bad Request")
            if length>17*1024*1024:
                return fail("413 Content Too Large")
            response = []
            def capture(status,headers,exc_info=None):
                response.extend([status,headers])
            try:
                iterable = self.app(environ,capture)
                try:
                    body = list(iterable)
                finally:
                    if hasattr(iterable,"close"):
                        iterable.close()
                if path!="/moto-api/":
                    self.store.save()
            except Exception:
                # A failed checkpoint cannot be followed by reads/acks from its uncommitted memory state.
                self.poisoned = True
                return fail("503 Service Unavailable")
            start_response(response[0],response[1])
            return body


if __name__ == "__main__":
    try:
        scope = os.environ.get("PROVIDER_SCOPE","fixture-test")
        if not re.fullmatch(r"(fixture-test|tt-dev|tt-stage|tt-test-[a-f0-9]{8,32})",scope):
            raise ValueError()
        provider = Provider(Store(os.environ.get("PROVIDER_STATE_DIRECTORY","/state"),scope))
        address = os.environ.get("PROVIDER_BIND_ADDRESS","0.0.0.0")
        if address not in ["0.0.0.0","127.0.0.1"]:
            raise ValueError()
        server = make_server(address,int(os.environ.get("MOTO_PORT","5000")),provider,threaded=True,request_handler=Quiet)
        server.serve_forever()
    except Exception:
        print("Local fixture provider startup refused; retain and inspect private checkpoint custody",flush=True)
        raise SystemExit(1)
