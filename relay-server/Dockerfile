# Read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile

FROM python:3.11

RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

COPY --chown=user ./requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

COPY --chown=user . /app
CMD ["sh", "-c", "if [ -z \"${SPACE_ID:-}\" ]; then echo 'SPACE_ID is not set'; exit 1; fi; slug=$(printf '%s' \"$SPACE_ID\" | tr '[:upper:]' '[:lower:]' | tr '/' '-'); printf '[\"https://%s.hf.space/connect\"]\\n' \"$slug\" > /app/servers.json && exec uvicorn main:app --host 0.0.0.0 --port 7860"]