# Claro Laboratorio IO

Aplicación académica de Investigación de Operaciones aplicada a Claro Colombia. Integra modelos de teoría de decisiones, teoría de juegos frente a Tigo, teoría de colas M/M/c y programación de proyectos con PERT y CPM en una interfaz web interactiva, con cálculos reproducibles, gráficas dinámicas y trazabilidad de los datos utilizados.

## Descripción

El proyecto usa información histórica pública para estudiar decisiones de Claro bajo distintos estados de demanda y para modelar la competencia de portabilidad entre Claro y Tigo. Incluye un caso histórico observado y escenarios académicos editables para experimentar con incertidumbre, probabilidades, señales y estrategias mixtas.

Los resultados tienen finalidad académica. Las estrategias proxy, clasificaciones, costos, respuestas y demás parámetros derivados no representan decisiones oficiales de Claro o Tigo ni constituyen una predicción comercial.

## Funcionalidades

- Contexto empresarial y metodología de Claro.
- Matriz editable de teoría de decisiones.
- Decisión sin probabilidades: criterio optimista (Maximax), criterio pesimista (Maximin/Wald), Laplace, Hurwicz y Savage/minimax de arrepentimiento en el motor de cálculo.
- Valor esperado, arrepentimiento esperado (EOL), valor esperado de información perfecta (EVPI/VEPI) y análisis de sensibilidad.
- Señal histórica, actualización de Bayes y árboles dinámicos de decisión.
- Matriz histórica de teoría de juegos frente a Tigo.
- Cálculo de maximin, minimax, dominancia, puntos de silla y valor del juego.
- Escenario didáctico de estrategias mixtas con probabilidades p y q, curvas de indiferencia y valor del juego.
- Edición independiente de matrices histórica e hipotética.
- Laboratorio M/M/c con Erlang C, nivel de servicio, sensibilidad para c=2…5 y rechazo de escenarios sin estado estable.
- Carga local de CSV de quejas, filtro fijo Claro/Telefonía móvil/Línea Telefónica, agregación mensual, cuantiles lineales y bitácora de cobertura.
- Exportación JSON de parámetros, operaciones, resultados, filtros, etiquetas, advertencias y fuentes de la ejecución de colas.
- Módulo PERT y CPM (`#pert-cpm`) del proyecto académico «Implementación de Módulo Avanzado PQR»: tiempo esperado TE = (a + 4m + b) / 6, orden topológico, recorridos hacia adelante y hacia atrás, holguras con tolerancia decimal, una o varias rutas críticas, probabilidad PERT opcional con aproximación normal y diagrama de red AON dinámico en SVG. Se calcula íntegramente en el navegador; el ejemplo precargado dura 23 semanas con ruta crítica A → C → D → E → F → I → J.
- Trazabilidad de los trimestres, grupos observados y supuestos de clasificación.
- Referencias institucionales externas, catálogo de colas F1–F9 y metodología reproducible.

## Tecnologías

- Python 3.11 o superior.
- FastAPI y Uvicorn para la API y el servidor web.
- Pydantic para validación de entradas.
- HTML, CSS y JavaScript en el frontend.
- Chart.js 4.4.8, distribuido localmente en `app/static/vendor/chart.umd.js`, para las gráficas.
- Pytest, HTTPX y Starlette TestClient para las pruebas.
- Node.js 20 o superior (opcional) para las pruebas del motor PERT/CPM con `node:test`; no se agregan dependencias npm ni hay paso de build de frontend.
- Playwright para la validación automatizada del navegador.

## Estructura del proyecto

```text
ClaroIO/
├── app/
│   ├── main.py              # Entrada de FastAPI
│   ├── models.py            # Modelos y validación Pydantic
│   ├── routes.py            # Endpoints de la API
│   ├── services.py          # Cálculos de decisiones, juegos, M/M/c y adaptación CSV
│   └── static/              # HTML, CSS, JavaScript y Chart.js
│       ├── pert-engine.js   # Motor PERT/CPM (funciones puras, sin DOM)
│       ├── pert-diagram.js  # Diagrama AON en SVG (layout y renderizado)
│       └── pert.js          # Interfaz del módulo PERT y CPM
├── data/initial.json        # Datos procesados y valores iniciales
├── scripts/browser_check.py # Pruebas de interfaz con Playwright
├── tests/                   # Pruebas unitarias y de API (tests/js: motor y diagrama PERT/CPM)
├── render.yaml              # Configuración de despliegue en Render
├── requirements.txt         # Dependencias de ejecución
└── requirements-dev.txt     # Dependencias para pruebas y desarrollo
```

## Instalación en Windows

Desde la carpeta del proyecto:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Para ejecutar también las pruebas de desarrollo:

```powershell
python -m pip install -r requirements-dev.txt
```

Si PowerShell bloquea la activación del entorno, puede ejecutarse directamente `\.venv\Scripts\python.exe` en los comandos siguientes.

## Ejecución local

Inicia el servidor con:

```powershell
python -m uvicorn app.main:app --reload
```

La aplicación queda disponible en:

```text
http://127.0.0.1:8000
```

La comprobación de salud de la API está en `http://127.0.0.1:8000/api/health`.

## Pruebas

Las pruebas de cálculo y API se ejecutan con:

```powershell
python -m pytest -q
```

El conjunto actual contiene 38 pruebas. Con el servidor ejecutándose y Playwright instalado, la revisión de interfaz se ejecuta con:

```powershell
$env:PYTHONIOENCODING='utf-8'
python scripts/browser_check.py
```

La revisión cubre escritorio, móvil, edición de escenarios, navegación, gráficas, CSV de colas, validaciones y ausencia de errores JavaScript.

## Fuentes de datos

Los archivos pesados de origen no se incrustan en el repositorio. La aplicación conserva los datos procesados necesarios para reproducir los cálculos y enlaza las fuentes institucionales:

- [CRC / Postdata](https://www.postdata.gov.co/)
- [Abonados, ingresos y tráfico de telefonía móvil](https://www.postdata.gov.co/index.php/dataset/abonados-ingresos-y-trafico-de-telefonia-movil)
- [Portabilidad Numérica Móvil](https://www.postdata.gov.co/dataset/portabilidad-numerica-movil)
- [Informes anuales de América Móvil](https://www.americamovil.com/English/investors/reports-and-filings/annual-reports/default.aspx)

## Metodología académica

El proyecto combina datos históricos públicos con cálculos derivados y parámetros académicos. Las estrategias proxy, clasificaciones y algunos parámetros económicos utilizados para aplicar los modelos no representan decisiones oficiales de Claro o Tigo.

En teoría de decisiones, los trimestres se clasifican en estados de demanda y se calculan criterios bajo incertidumbre, probabilidades históricas, valor esperado y actualización de Bayes. En teoría de juegos, las categorías competitivas son proxies construidos desde series de portabilidad; el pago relativo se calcula como:

```text
uClaro = (portabilidad neta de Claro − portabilidad neta de Tigo) / 1.000
```

La matriz histórica y el escenario hipotético se mantienen separados para distinguir evidencia observada de un ejemplo pedagógico.

## Despliegue

El proyecto incluye [render.yaml](render.yaml) y está preparado para Render. La configuración usa `requirements.txt`, inicia `uvicorn app.main:app --host 0.0.0.0 --port $PORT` y expone `/api/health` como comprobación de salud.

Para desplegarlo, sube el repositorio a GitHub, crea un Web Service en Render conectado a la rama `main` y conserva las variables y comandos definidos por `render.yaml`. No se requieren secretos ni credenciales para ejecutar el modelo actual.

## Licencia y alcance

Este repositorio corresponde a un proyecto universitario de carácter académico. Las fuentes mantienen sus propias condiciones de uso y los resultados deben interpretarse dentro de los supuestos y el periodo histórico documentados en la aplicación.
