import config
import os
print(f"DEBUG: Found GEMINI_KEY: {'Yes' if hasattr(config, 'GEMINI_KEY') else 'No'}")
print(f"DEBUG: Config File Location: {os.path.abspath(config.__file__)}")