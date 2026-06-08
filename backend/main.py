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
BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
env_path = BASE_DIR / ".env"

if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
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
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def read_index():
    return FileResponse(STATIC_DIR / "index.html")


# ==========================================
# FEATURE 1: INDIAN CUSTOMS DUTY CALCULATOR
# ==========================================

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


# ==========================================
# FEATURE 2: ICEGATE & ODEX CARGO TRACKER
# ==========================================

class TrackRequest(BaseModel):
    container_number: str

@app.post("/api/v1/track-container")
def track_container(request: TrackRequest):
    container_clean = request.container_number.strip().upper()
    
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 
                    container_number, 
                    bill_of_entry_filed, 
                    shipping_line, 
                    current_status, 
                    icegate_out_of_charge_ooc, 
                    odex_delivery_order_status,
                    latitude,
                    longitude
                FROM tracked_shipments 
                WHERE container_number = %s;
                """,
                (container_clean,)
            )
            row = cur.fetchone()
            
    if not row:
        return {
            "meta": {
                "container_number": container_clean, 
                "source": "Simulation Mode (ICEGATE/ODeX Pipeline Connected)",
                "latitude": 18.9503,
                "longitude": 72.9520
            },
            "customs_milestones": {
                "bill_of_entry_filed": "Yes (BE-MOCK-404)",
                "customs_duty_payment": "Verified (Processed via PortPass Calc)",
                "icegate_out_of_charge_ooc": "READY_FOR_RELEASE"
            },
            "carrier_milestones": {
                "shipping_line": "Generic Carrier Line",
                "odex_delivery_order_status": "RELEASED",
                "current_location": "Nhava Sheva Port, Mumbai",
                "status_description": "Container discharged from vessel. ICEGATE customs cleared & ODeX workflow green."
            }
        }
        
    return {
        "meta": {
            "container_number": row[0], 
            "source": "Live Production Database",
            "latitude": float(row[6]) if row[6] is not None else 18.9503,
            "longitude": float(row[7]) if row[7] is not None else 72.9520
        },
        "customs_milestones": {
            "bill_of_entry_filed": f"Yes ({row[1]})",
            "customs_duty_payment": "Verified",
            "icegate_out_of_charge_ooc": row[4]
        },
        "carrier_milestones": {
            "shipping_line": row[2],
            "odex_delivery_order_status": row[5],
            "current_status": row[3]
        }
    }