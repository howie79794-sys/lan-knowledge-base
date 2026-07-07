ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i \
      -e "s|http://deb.debian.org/debian|${APT_MIRROR}|g" \
      -e "s|https://deb.debian.org/debian|${APT_MIRROR}|g" \
      -e "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
      -e "s|https://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
      /etc/apt/sources.list.d/debian.sources; \
  elif [ -f /etc/apt/sources.list ]; then \
    sed -i \
      -e "s|http://deb.debian.org/debian|${APT_MIRROR}|g" \
      -e "s|https://deb.debian.org/debian|${APT_MIRROR}|g" \
      -e "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
      -e "s|https://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
      /etc/apt/sources.list; \
  fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -i "${PIP_INDEX_URL}" -r requirements.txt

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
