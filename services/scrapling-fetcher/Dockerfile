FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SCRAPLING_FETCHER_MODE=fetcher \
    SCRAPLING_BROWSER_FETCH_ENABLED=false \
    SCRAPLING_MAX_CHARS=200000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8092/health', timeout=5).read()"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8092"]
