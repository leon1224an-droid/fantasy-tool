web: alembic upgrade head || (echo "MIGRATION FAILED - trying to start server anyway" && true) && uvicorn backend.main:app --host 0.0.0.0 --port $PORT
