import os
import pathlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from psycopg_pool import ConnectionPool
from dotenv import load_dotenv

# --- STRICT LOADING: Force .env from root directory ---
# Since main.py is inside backend/, .parent.parent points to the root 'portpass/' folder
BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
env_path = BASE_DIR / ".env"

if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    # Fallback to local execution directory or cloud native environments
    load_dotenv()

# Retrieve the variable
DATABASE_URL = os.getenv("DATABASE_URL")

# --- CRITICAL: Debugging & Validation ---
if not DATABASE_URL:
    raise ValueError(f"CRITICAL ERROR: DATABASE_URL is not set! Check file at: {env_path} or environment variables.")

print(f"DEBUG: Successfully loaded DATABASE_URL: {DATABASE_URL[:20]}...") 

# Initialize the pool using the verified DATABASE_URL
pool = ConnectionPool(conninfo=DATABASE_URL, min_size=1, max_size=10)

@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    yield
    pool.close()

app = FastAPI(lifespan=lifespan)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define clean folder definitions relative to main.py
CURRENT_DIR = pathlib.Path(__file__).resolve().parent
STATIC_DIR = CURRENT_DIR / "static"

# --- Serve Frontend Files ---
# Mounts the 'static' folder located directly next to main.py
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def read_index():
    # Points cleanly to 'backend/static/index.html' at the root domain path
    return FileResponse(STATIC_DIR / "index.html")

class IndianDutyRequest(BaseModel):
    hsn_code: str
    assessable_value: float

@app.post("/api/v1/calculate-indian-duty")
def calculate_indian_duty(request: IndianDutyRequest):
    hsn = "".join(filter(str.isalnum, request.hsn_code))
    cif_value = request.assessable_value

    if len(hsn) not in [4, 6, 8]:
        raise HTTPException(status_code=400, detail="Invalid HSN code length. Indian HSN should be 4, 6, or 8 digits.")

    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT hsn_code, description, bcd_rate, igst_rate 
                FROM indian_hsn_tariffs 
                WHERE hsn_code = %s;
                """,
                (hsn,)
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(
            status_code=404, 
            detail=f"HSN Code '{hsn}' not found."
        )

    db_hsn, description, bcd_rate, igst_rate = row

    bcd_pct = float(bcd_rate)
    igst_pct = float(igst_rate)

    bcd_amount = round(cif_value * (bcd_pct / 100), 2)
    sws_amount = round(bcd_amount * 0.10, 2)
    value_for_igst = cif_value + bcd_amount + sws_amount
    igst_amount = round(value_for_igst * (igst_pct / 100), 2)
    
    total_duty_payable = round(bcd_amount + sws_amount + igst_amount, 2)
    total_landing_cost = round(cif_value + total_duty_payable, 2)

    return {
        "meta": {
            "hsn_code": db_hsn,
            "description": description,
            "jurisdiction": "India"
        },
        "rates_applied": {
            "bcd_percentage": f"{bcd_pct}%",
            "sws_percentage": "10% of BCD",
            "igst_percentage": f"{igst_pct}%"
        },
        "financial_breakdown": {
            "assessable_value_cif": cif_value,
            "basic_customs_duty_bcd": bcd_amount,
            "social_welfare_surcharge_sws": sws_amount,
            "value_subject_to_igst": value_for_igst,
            "integrated_gst_igst": igst_amount,
            "total_duty_payable": total_duty_payable,
            "total_landed_cost": total_landing_cost
        }
    }
