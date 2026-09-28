from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from app.routes import router

STATIC = Path(__file__).resolve().parent / 'static'
app = FastAPI(title='Claro · Laboratorio de decisiones', version='1.0.0')
app.include_router(router)

@app.exception_handler(RequestValidationError)
async def invalid_input(request, exc):
    errors = [{'field': '.'.join(str(x) for x in e['loc'][1:]), 'message': e['msg']} for e in exc.errors()]
    return JSONResponse(status_code=422, content={'detail': errors})

@app.get('/', include_in_schema=False)
def home():
    return FileResponse(STATIC / 'index.html')

app.mount('/static', StaticFiles(directory=STATIC), name='static')
