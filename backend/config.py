import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
GROQ_MODEL = 'openai/gpt-oss-120b'
FLASK_PORT = int(os.getenv('FLASK_PORT', '5000'))
FLASK_DEBUG = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
MAX_UPLOAD_SIZE_MB = 50
SPECTER_MODEL_NAME = 'allenai/specter2_base'
