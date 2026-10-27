FROM motoserver/moto:5.2.0@sha256:d8d063e3e704d256cbe8165072fa273c17698be91311e49fc602b7716f459bea
COPY infra/local/provider/*.py /provider/
RUN mkdir /state && chown 1000:1000 /state && chmod 700 /state
USER 1000:1000
ENV PROVIDER_STATE_DIRECTORY=/state
ENV PYTHONPATH=/provider
ENTRYPOINT ["python", "/provider/server.py"]
