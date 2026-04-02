from flask import Flask
from flask_cors import CORS

from backend.config import MAX_UPLOAD_SIZE_MB, FLASK_PORT, FLASK_DEBUG


def create_app() -> Flask:
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    CORS(app)

    from backend.routes import parse, explain, query, compare, citation
    app.register_blueprint(parse.bp)
    app.register_blueprint(explain.bp)
    app.register_blueprint(query.bp)
    app.register_blueprint(compare.bp)
    app.register_blueprint(citation.bp)

    @app.route('/api/health')
    def health():
        return {'status': 'ok'}

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(port=FLASK_PORT, debug=FLASK_DEBUG)
