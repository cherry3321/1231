from flask import Flask, render_template, request, jsonify, send_from_directory, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from datetime import datetime
import os, uuid, re, sqlite3

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'xchat-secret-2024')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///messenger.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ── Models ────────────────────────────────────────────────────────────────────

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    display_name = db.Column(db.String(80), default='')
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    avatar_color = db.Column(db.String(20), default='#5B7FFF')
    avatar_url = db.Column(db.String(300), default='')
    bio = db.Column(db.String(200), default='')
    status = db.Column(db.String(20), default='online')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    socket_id = db.Column(db.String(100), default='')

    def to_dict(self):
        return {
            'id': self.id, 'username': self.username,
            'display_name': self.display_name or self.username,
            'email': self.email, 'avatar_color': self.avatar_color,
            'avatar_url': self.avatar_url or '', 'bio': self.bio or '',
            'status': self.status, 'created_at': self.created_at.isoformat()
        }

class Chat(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), default='')
    is_group = db.Column(db.Boolean, default=False)
    description = db.Column(db.String(300), default='')
    avatar_color = db.Column(db.String(20), default='#5B7FFF')
    avatar_url = db.Column(db.String(300), default='')
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    members = db.relationship('ChatMember', backref='chat', lazy=True, cascade='all, delete-orphan')
    messages = db.relationship('Message', backref='chat', lazy=True, cascade='all, delete-orphan')

class ChatMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chat.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chat.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, default='')
    msg_type = db.Column(db.String(20), default='text')  # text, image, file, voice
    file_url = db.Column(db.String(300), default='')
    file_name = db.Column(db.String(200), default='')
    file_size = db.Column(db.Integer, default=0)
    duration = db.Column(db.Integer, default=0)  # voice duration seconds
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        sender = User.query.get(self.sender_id)
        return {
            'id': self.id, 'chat_id': self.chat_id,
            'sender_id': self.sender_id,
            'sender_username': (sender.display_name or sender.username) if sender else 'Unknown',
            'sender_color': sender.avatar_color if sender else '#999',
            'sender_avatar_url': sender.avatar_url if sender else '',
            'content': self.content, 'msg_type': self.msg_type,
            'file_url': self.file_url, 'file_name': self.file_name,
            'file_size': self.file_size, 'duration': self.duration or 0,
            'created_at': self.created_at.isoformat()
        }

# ── Safe migrate: add missing columns without dropping DB ────────────────────

def safe_migrate():
    db_path = os.path.join('instance', 'messenger.db')
    if not os.path.exists(db_path):
        db_path = 'messenger.db'
    if not os.path.exists(db_path):
        return
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        migrations = [
            ("message", "duration", "INTEGER DEFAULT 0"),
            ("chat", "avatar_url", "TEXT DEFAULT ''"),
            ("user", "display_name", "TEXT DEFAULT ''"),
            ("user", "avatar_url", "TEXT DEFAULT ''"),
            ("user", "bio", "TEXT DEFAULT ''"),
        ]
        for table, col, col_def in migrations:
            try:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
                conn.commit()
            except sqlite3.OperationalError:
                pass  # column already exists
        conn.close()
    except Exception as e:
        print(f"Migration note: {e}")

# ── Auth ──────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username', '').strip()
    display_name = data.get('display_name', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    if not username or not email or not password:
        return jsonify({'error': 'Все поля обязательны'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Логин минимум 3 символа'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Пароль минимум 6 символов'}), 400
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return jsonify({'error': 'Логин: только латиница, цифры и _'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Логин уже занят'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email уже используется'}), 400
    colors = ['#5B7FFF','#E8533F','#4CAF82','#9C6DD8','#F5A623','#00BCD4','#E91E8C','#FF7043']
    hashed = bcrypt.generate_password_hash(password).decode('utf-8')
    user = User(username=username, display_name=display_name or username,
                email=email, password=hashed, avatar_color=colors[len(username) % len(colors)])
    db.session.add(user)
    db.session.commit()
    session['user_id'] = user.id
    session.permanent = True
    return jsonify({'user': user.to_dict()})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    user = User.query.filter_by(username=username).first()
    if not user or not bcrypt.check_password_hash(user.password, password):
        return jsonify({'error': 'Неверный логин или пароль'}), 401
    session['user_id'] = user.id
    session.permanent = True
    user.status = 'online'
    db.session.commit()
    return jsonify({'user': user.to_dict()})

@app.route('/api/logout', methods=['POST'])
def logout():
    uid = session.get('user_id')
    if uid:
        u = User.query.get(uid)
        if u: u.status = 'offline'; db.session.commit()
    session.clear()
    return jsonify({'ok': True})

@app.route('/api/me')
def me():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    u = User.query.get(uid)
    if not u: return jsonify({'error': 'Не авторизован'}), 401
    return jsonify({'user': u.to_dict()})

@app.route('/api/update_profile', methods=['POST'])
def update_profile():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    u = User.query.get(uid)
    data = request.json
    if 'bio' in data: u.bio = data['bio'][:200]
    if 'avatar_color' in data: u.avatar_color = data['avatar_color']
    if 'avatar_url' in data: u.avatar_url = data['avatar_url']
    if 'display_name' in data: u.display_name = data['display_name'][:80]
    if 'username' in data:
        new_name = data['username'].strip()
        if new_name and new_name != u.username:
            if not re.match(r'^[a-zA-Z0-9_]+$', new_name):
                return jsonify({'error': 'Логин: только латиница, цифры и _'}), 400
            if User.query.filter_by(username=new_name).first():
                return jsonify({'error': 'Логин занят'}), 400
            u.username = new_name
    if 'new_password' in data and data['new_password']:
        if len(data['new_password']) < 6:
            return jsonify({'error': 'Пароль минимум 6 символов'}), 400
        u.password = bcrypt.generate_password_hash(data['new_password']).decode('utf-8')
    db.session.commit()
    return jsonify({'user': u.to_dict()})

@app.route('/api/upload_avatar', methods=['POST'])
def upload_avatar():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    if 'avatar' not in request.files: return jsonify({'error': 'Нет файла'}), 400
    f = request.files['avatar']
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ['.jpg','.jpeg','.png','.gif','.webp']:
        return jsonify({'error': 'Только изображения'}), 400
    fname = f"avatar_{uid}_{uuid.uuid4().hex[:8]}{ext}"
    f.save(os.path.join(app.config['UPLOAD_FOLDER'], fname))
    url = f'/static/uploads/{fname}'
    u = User.query.get(uid); u.avatar_url = url; db.session.commit()
    return jsonify({'url': url, 'user': u.to_dict()})

# ── User profile ──────────────────────────────────────────────────────────────

@app.route('/api/user/<int:user_id>')
def get_user(user_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    u = User.query.get_or_404(user_id)
    return jsonify({'user': u.to_dict()})

@app.route('/api/search_users')
def search_users():
    uid = session.get('user_id')
    q = request.args.get('q', '').strip()
    if not q: return jsonify({'users': []})
    users = User.query.filter(User.username.ilike(f'%{q}%'), User.id != uid).limit(10).all()
    return jsonify({'users': [u.to_dict() for u in users]})

# ── Chats ─────────────────────────────────────────────────────────────────────

@app.route('/api/chats')
def get_chats():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    memberships = ChatMember.query.filter_by(user_id=uid).all()
    result = []
    for m in memberships:
        chat = Chat.query.get(m.chat_id)
        if not chat: continue
        last_msg = Message.query.filter_by(chat_id=chat.id).order_by(Message.created_at.desc()).first()
        unread = Message.query.filter_by(chat_id=chat.id, is_read=False).filter(Message.sender_id != uid).count()
        if chat.is_group:
            name = chat.name; color = chat.avatar_color; avatar_url = chat.avatar_url or ''
            other_user_id = None
        else:
            om = ChatMember.query.filter(ChatMember.chat_id==chat.id, ChatMember.user_id!=uid).first()
            ou = User.query.get(om.user_id) if om else None
            name = (ou.display_name or ou.username) if ou else 'Unknown'
            color = ou.avatar_color if ou else '#999'
            avatar_url = ou.avatar_url if ou else ''
            other_user_id = ou.id if ou else None
        result.append({
            'id': chat.id, 'name': name, 'is_group': chat.is_group,
            'description': chat.description, 'avatar_color': color,
            'avatar_url': avatar_url, 'other_user_id': other_user_id,
            'last_message': last_msg.to_dict() if last_msg else None,
            'unread_count': unread, 'created_at': chat.created_at.isoformat(),
            'is_admin': m.is_admin
        })
    result.sort(key=lambda x: x['last_message']['created_at'] if x['last_message'] else x['created_at'], reverse=True)
    return jsonify({'chats': result})

@app.route('/api/chat/<int:chat_id>/messages')
def get_messages(chat_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    if not ChatMember.query.filter_by(chat_id=chat_id, user_id=uid).first():
        return jsonify({'error': 'Нет доступа'}), 403
    msgs = Message.query.filter_by(chat_id=chat_id).order_by(Message.created_at.asc()).all()
    Message.query.filter_by(chat_id=chat_id, is_read=False).filter(
        Message.sender_id != uid).update({'is_read': True})
    db.session.commit()
    return jsonify({'messages': [m.to_dict() for m in msgs]})

@app.route('/api/chat/<int:chat_id>/info')
def chat_info(chat_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    chat = Chat.query.get_or_404(chat_id)
    members = []
    for m in chat.members:
        u = User.query.get(m.user_id)
        if u: members.append({**u.to_dict(), 'is_admin': m.is_admin})
    return jsonify({'chat': {
        'id': chat.id, 'name': chat.name, 'is_group': chat.is_group,
        'description': chat.description, 'avatar_color': chat.avatar_color,
        'avatar_url': chat.avatar_url or '', 'created_by': chat.created_by, 'members': members
    }})

@app.route('/api/create_direct', methods=['POST'])
def create_direct():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    target = User.query.filter_by(username=request.json.get('username','').strip()).first()
    if not target: return jsonify({'error': 'Пользователь не найден'}), 404
    if target.id == uid: return jsonify({'error': 'Нельзя написать себе'}), 400
    my_chats = {m.chat_id for m in ChatMember.query.filter_by(user_id=uid).all()}
    their_chats = {m.chat_id for m in ChatMember.query.filter_by(user_id=target.id).all()}
    for cid in my_chats & their_chats:
        c = Chat.query.get(cid)
        if c and not c.is_group:
            return jsonify({'chat_id': cid, 'existing': True})
    chat = Chat(is_group=False, created_by=uid)
    db.session.add(chat); db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=uid, is_admin=True))
    db.session.add(ChatMember(chat_id=chat.id, user_id=target.id))
    db.session.commit()
    return jsonify({'chat_id': chat.id, 'existing': False})

@app.route('/api/create_group', methods=['POST'])
def create_group():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    data = request.json
    name = data.get('name','').strip()
    if not name: return jsonify({'error': 'Название обязательно'}), 400
    colors = ['#5B7FFF','#E8533F','#4CAF82','#9C6DD8','#F5A623','#00BCD4']
    chat = Chat(name=name, description=data.get('description','').strip(), is_group=True,
                created_by=uid, avatar_color=colors[len(name) % len(colors)])
    db.session.add(chat); db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=uid, is_admin=True))
    for uname in data.get('members', []):
        u = User.query.filter_by(username=uname.strip()).first()
        if u and u.id != uid:
            db.session.add(ChatMember(chat_id=chat.id, user_id=u.id))
    db.session.commit()
    return jsonify({'chat_id': chat.id})

@app.route('/api/group/<int:chat_id>/add_member', methods=['POST'])
def add_member(chat_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    admin = ChatMember.query.filter_by(chat_id=chat_id, user_id=uid, is_admin=True).first()
    if not admin: return jsonify({'error': 'Нет прав'}), 403
    uname = request.json.get('username','').strip()
    u = User.query.filter_by(username=uname).first()
    if not u: return jsonify({'error': 'Пользователь не найден'}), 404
    if ChatMember.query.filter_by(chat_id=chat_id, user_id=u.id).first():
        return jsonify({'error': 'Уже в группе'}), 400
    db.session.add(ChatMember(chat_id=chat_id, user_id=u.id))
    db.session.commit()
    socketio.emit('member_added', {'chat_id': chat_id, 'user': u.to_dict()}, room=f'chat_{chat_id}')
    return jsonify({'ok': True})

@app.route('/api/group/<int:chat_id>/leave', methods=['POST'])
def leave_group(chat_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    m = ChatMember.query.filter_by(chat_id=chat_id, user_id=uid).first()
    if not m: return jsonify({'error': 'Вы не в группе'}), 400
    db.session.delete(m); db.session.commit()
    socketio.emit('member_left', {'chat_id': chat_id, 'user_id': uid}, room=f'chat_{chat_id}')
    return jsonify({'ok': True})

@app.route('/api/group/<int:chat_id>/kick', methods=['POST'])
def kick_member(chat_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    admin = ChatMember.query.filter_by(chat_id=chat_id, user_id=uid, is_admin=True).first()
    if not admin: return jsonify({'error': 'Нет прав'}), 403
    target_id = request.json.get('user_id')
    m = ChatMember.query.filter_by(chat_id=chat_id, user_id=target_id).first()
    if m: db.session.delete(m); db.session.commit()
    socketio.emit('member_left', {'chat_id': chat_id, 'user_id': target_id}, room=f'chat_{chat_id}')
    return jsonify({'ok': True})

@app.route('/api/group/<int:chat_id>/delete', methods=['POST'])
def delete_group(chat_id):
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    chat = Chat.query.get_or_404(chat_id)
    if chat.created_by != uid: return jsonify({'error': 'Нет прав'}), 403
    socketio.emit('chat_deleted', {'chat_id': chat_id}, room=f'chat_{chat_id}')
    db.session.delete(chat); db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    f = request.files.get('file')
    if not f or not f.filename: return jsonify({'error': 'Нет файла'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    fname = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(app.config['UPLOAD_FOLDER'], fname)
    f.save(path)
    return jsonify({'url': f'/static/uploads/{fname}', 'name': f.filename, 'size': os.path.getsize(path)})

@app.route('/api/upload_voice', methods=['POST'])
def upload_voice():
    uid = session.get('user_id')
    if not uid: return jsonify({'error': 'Не авторизован'}), 401
    f = request.files.get('voice')
    if not f: return jsonify({'error': 'Нет файла'}), 400
    duration = int(request.form.get('duration', 0))
    fname = f"voice_{uuid.uuid4().hex}.webm"
    path = os.path.join(app.config['UPLOAD_FOLDER'], fname)
    f.save(path)
    return jsonify({'url': f'/static/uploads/{fname}', 'duration': duration, 'size': os.path.getsize(path)})

@app.route('/static/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ── Sockets ───────────────────────────────────────────────────────────────────

@socketio.on('connect')
def on_connect():
    uid = session.get('user_id')
    if uid:
        u = User.query.get(uid)
        if u:
            u.status = 'online'; u.socket_id = request.sid; db.session.commit()
            for m in ChatMember.query.filter_by(user_id=uid).all():
                join_room(f'chat_{m.chat_id}')
            emit('connected', {'user_id': uid})

@socketio.on('disconnect')
def on_disconnect():
    uid = session.get('user_id')
    if uid:
        u = User.query.get(uid)
        if u: u.status = 'offline'; u.socket_id = ''; db.session.commit()

@socketio.on('send_message')
def handle_message(data):
    uid = session.get('user_id')
    if not uid: return
    chat_id = data.get('chat_id')
    if not ChatMember.query.filter_by(chat_id=chat_id, user_id=uid).first(): return
    msg = Message(
        chat_id=chat_id, sender_id=uid,
        content=data.get('content','').strip(),
        msg_type=data.get('msg_type','text'),
        file_url=data.get('file_url',''), file_name=data.get('file_name',''),
        file_size=data.get('file_size',0), duration=data.get('duration',0)
    )
    db.session.add(msg); db.session.commit()
    emit('new_message', msg.to_dict(), room=f'chat_{chat_id}')

@socketio.on('typing')
def handle_typing(data):
    uid = session.get('user_id')
    if not uid: return
    u = User.query.get(uid)
    emit('user_typing', {'user_id': uid, 'username': u.display_name or u.username, 'chat_id': data.get('chat_id')},
         room=f'chat_{data.get("chat_id")}', include_self=False)

@socketio.on('join_chat')
def handle_join(data):
    join_room(f'chat_{data.get("chat_id")}')

if __name__ == '__main__':
    with app.app_context():
        safe_migrate()
        db.create_all()
    port = int(os.environ.get('PORT', 5050))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
