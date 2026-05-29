# With docker-compose (recommended)
docker compose up --build

# Or plain Docker
docker build -t chameleon .
docker run -p 8000:8000 chameleon