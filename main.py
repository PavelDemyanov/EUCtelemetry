from app import app
import logging

if __name__ == "__main__":
    # Enable debug logging
    logging.basicConfig(level=logging.DEBUG)
    app.run(host="0.0.0.0", port=5000, debug=True)