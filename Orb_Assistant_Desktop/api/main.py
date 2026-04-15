import sys
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import asyncio
from typing import Dict, Any
from fastapi.middleware.cors import CORSMiddleware

# Ensure the electron src directory is in the path to import components
project_root = Path(__file__).resolve().parent.parent
sys.path.append(str(project_root / "electron" / "src"))

from components.core_4_minds.tribunal import FourMindTribunal

app = FastAPI(title="Spruked ORB Backend", version="1.0.0")

# Setup CORS to allow requests from the web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this to "https://spruked.com" in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the Council once on startup
# Using the path to the original electron folder to ensure it finds the skg files
skg_path = project_root / "electron" / "src" / "components" / "core_4_minds"
council = FourMindTribunal(skg_path=str(skg_path))

class Query(BaseModel):
    prompt: str
    context: Dict[str, Any] | None = None

@app.post("/api/v1/tribunal")
async def ask_the_council(query: Query):
    """
    Asynchronous endpoint to handle the 'Council of Four' logic.
    For the web demo, this prevents timeouts and processes the stimulus.
    """
    try:
        # Construct stimulus from the user's prompt
        stimulus = {"prompt": query.prompt, "context": query.context or {}}
        
        # This calls Cali's core adjudication logic to generate exact epistemic shadows
        shadows = council.generate_epistemic_shadow(stimulus)
        
        # Determine the leading mind for visual feedback in the UI
        leading_mind = max(shadows.items(), key=lambda x: x[1]['confidence'])[0]
        confidence = shadows[leading_mind]['confidence']
        
        # Synthesize a temporary generic text response based on the leading mind
        response_text = f"The tribunal has evaluated your input. {leading_mind.title()} has taken the lead with a confidence weight of {confidence}."
        
        # Simulated delay to represent the "thinking" process over WebSockets/Streaming later
        await asyncio.sleep(1.0)
        
        return {
            "status": "success",
            "response": response_text,
            "metadata": {
                "leading_mind": leading_mind,
                "confidence": confidence,
                "shadows": shadows,
                "vault_update": "pending"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/health")
async def health_check():
    return {"status": "ORB System Operational", "layer": "FastAPI Core"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
