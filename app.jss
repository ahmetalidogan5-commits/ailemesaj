const SUPABASE_URL = 'https://ployahzyeczqtyxeqton.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qMmoexXttQXgnfxutOjU6g_OcnRTMX0';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let user = null;
let profiles = {};
let editingId = null;
let mediaRecorder = null;
let audioChunks = [];
let recording = false;
let msgChannel = null;

const $ = (id) => document.getElementById(id);

function showAuth(message) {
  $('authMsg').textContent = message;
}

function scrollBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatTime(dateString) {
  return new Date(dateString).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

$('registerBtn').onclick = async () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  const name = $('name').value.trim();

  if (!email || !password) {
    showAuth('E-posta ve şifre zorunlu.');
    return;
  }

  const { error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name || email.split('@')[0]
      }
    }
  });

  if (error) {
    showAuth(error.message);
  } else {
    showAuth('Kayıt başarılı.');
  }
};

$('loginBtn').onclick = async () => {
  const email = $('email').value.trim();
  const password = $('password').value;

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showAuth(error.message);
  }
};

$('logoutBtn').onclick = async () => {
  await db.auth.signOut();
};

db.auth.onAuthStateChange(async (event, session) => {
  user = session?.user ?? null;

  if (user) {
    $('auth').classList.add('hidden');
    $('chat').classList.remove('hidden');
    $('whoami').textContent = user.email;

    await ensureProfile();
    await loadProfiles();
    await loadMessages();
    subscribeMessages();
  } else {
    $('chat').classList.add('hidden');
    $('auth').classList.remove('hidden');
    $('messages').innerHTML = '';
    $('msgInput').value = '';
    cancelEditing();

    if (msgChannel) {
      db.removeChannel(msgChannel);
      msgChannel = null;
    }
  }
});

async function ensureProfile() {
  const { data } = await db
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!data) {
    const name = user.user_metadata?.name || user.email?.split('@')[0] || 'Aile';

    await db.from('profiles').upsert({
      id: user.id,
      name
    });
  }
}

async function loadProfiles() {
  const { data, error } = await db
    .from('profiles')
    .select('id,name');

  if (error) {
    console.error(error);
    return;
  }

  profiles = {};

  (data || []).forEach(profile => {
    profiles[profile.id] = profile.name;
  });

  if (profiles[user.id]) {
    $('whoami').textContent = profiles[user.id];
  }
}

async function loadMessages() {
  $('messages').innerHTML = '';

  const { data, error } = await db
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(300);

  if (error) {
    alert(error.message);
    return;
  }

  for (const message of data || []) {
    await addMessage(message, false);
  }

  scrollBottom();
}

async function addMessage(message, scroll = true) {
  if (document.querySelector(`[data-id="${message.id}"]`)) return;

  const div = document.createElement('div');
  div.className = `msg ${message.sender_id === user.id ? 'own' : ''}`;
  div.dataset.id = message.id;

  const senderName = profiles[message.sender_id] || 'Aile';

  div.innerHTML = `
    <div class="meta">
      ${escapeHtml(senderName)} · ${formatTime(message.created_at)}
      ${message.edited_at ? ' · düzenlendi' : ''}
    </div>
    <div class="body"></div>
    <div class="actions"></div>
  `;

  const body = div.querySelector('.body');

  if (message.type === 'text') {
    body.innerHTML = `<p>${escapeHtml(message.content)}</p>`;
  }

  if (message.type === 'image') {
    body.innerHTML = `<img alt="Fotoğraf" loading="lazy" />`;
  }

  if (message.type === 'voice') {
    body.innerHTML = `<audio controls preload="metadata"></audio>`;
  }

  if (message.file_path) {
    const { data, error } = await db.storage
      .from('files')
      .createSignedUrl(message.file_path, 3600);

    const mediaElement = body.querySelector('img, audio');

    if (data?.signedUrl && mediaElement) {
      mediaElement.src = data.signedUrl;
    } else if (error) {
      body.innerHTML = `<p>Dosya yüklenemedi.</p>`;
    }
  }

  const actions = div.querySelector('.actions');

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.textContent = 'Paylaş';
  shareBtn.onclick = () => shareMessage(message);
  actions.appendChild(shareBtn);

  if (message.sender_id === user.id) {
    if (message.type === 'text') {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Düzenle';
      editBtn.onclick = () => startEdit(message);
      actions.appendChild(editBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Sil';
    deleteBtn.onclick = () => deleteMessage(message.id);
    actions.appendChild(deleteBtn);
  }

  $('messages').appendChild(div);

  if (scroll) {
    scrollBottom();
  }
}

function updateMessage(message) {
  const element = document.querySelector(`[data-id="${message.id}"]`);
  if (!element) return;

  const p = element.querySelector('.body p');
  if (message.type === 'text' && p) {
    p.textContent = message.content;
  }

  const meta = element.querySelector('.meta');
  if (meta) {
    const senderName = profiles[message.sender_id] || 'Aile';
    meta.innerHTML = `
      ${escapeHtml(senderName)} · ${formatTime(message.created_at)}
      ${message.edited_at ? ' · düzenlendi' : ''}
    `;
  }
}

function subscribeMessages() {
  if (msgChannel) {
    db.removeChannel(msgChannel);
  }

  msgChannel = db
    .channel('aile-messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      async (payload) => {
        await addMessage(payload.new, true);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        updateMessage(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        const element = document.querySelector(`[data-id="${payload.old?.id}"]`);
        if (element) element.remove();
      }
    )
    .subscribe();
}

$('sendForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = $('msgInput').value.trim();
  if (!text) return;

  if (editingId) {
    const { error } = await db
      .from('messages')
      .update({
        content: text,
        edited_at: new Date().toISOString()
      })
      .eq('id', editingId);

    if (error) {
      alert(error.message);
    }

    cancelEditing();
  } else {
    const { error } = await db
      .from('messages')
      .insert({
        sender_id: user.id,
        type: 'text',
        content: text
      });

    if (error) {
      alert(error.message);
    }
  }

  $('msgInput').value = '';
  scrollBottom();
});

function startEdit(message) {
  if (message.type !== 'text') return;

  editingId = message.id;
  $('msgInput').value = message.content || '';
  $('editingBar').classList.remove('hidden');
  $('msgInput').focus();
}

function cancelEditing() {
  editingId = null;
  $('editingBar').classList.add('hidden');
}

$('cancelEdit').onclick = () => {
  cancelEditing();
};

async function deleteMessage(id) {
  if (!confirm('Bu mesaj silinsin mi?')) return;

  const { error } = await db
    .from('messages')
    .delete()
    .eq('id', id);

  if (error) {
    alert(error.message);
  }
}

async function shareMessage(message) {
  let text = '';

  if (message.type === 'text') {
    text = message.content || '';
  } else if (message.type === 'image') {
    text = 'Aile Sohbet: Fotoğraf mesajı';
  } else if (message.type === 'voice') {
    text = 'Aile Sohbet: Sesli mesaj';
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Aile Sohbet',
        text
      });
    } catch (error) {
    }
  } else {
    try {
      await navigator.clipboard.writeText(text);
      alert('Mesaj kopyalandı.');
    } catch (error) {
      alert('Paylaşma veya kopyalama desteklenmedi.');
    }
  }
}

$('photoBtn').onclick = () => {
  $('photoInput').click();
};

$('photoInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file) return;

  await uploadAndSend(file, 'image');
});

async function uploadAndSend(file, type) {
  const extension = file.name?.split('.')?.pop()?.toLowerCase() || (type === 'image' ? 'jpg' : 'webm');

  const path = `${user.id}/${Date.now()}.${extension}`;

  const { error: uploadError } = await db.storage
    .from('files')
    .upload(path, file);

  if (uploadError) {
    alert(uploadError.message);
    return;
  }

  const { error: messageError } = await db
    .from('messages')
    .insert({
      sender_id: user.id,
      type,
      file_path: path
    });

  if (messageError) {
    alert(messageError.message);
  }
}

$('voiceBtn').onclick = async () => {
  try {
    if (!recording) {
      await startRecording();
    } else {
      stopRecording();
    }
  } catch (error) {
    console.error(error);
    alert('Mikrofon izni verilmedi veya ses kaydı başlatılamadı.');
  }
};

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  audioChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(track => track.stop());

    const blob = new Blob(audioChunks, { type: 'audio/webm' });

    const file = new File([blob], `voice_${Date.now()}.webm`, {
      type: 'audio/webm'
    });

    await uploadAndSend(file, 'voice');
  };

  mediaRecorder.start();
  recording = true;
  $('voiceBtn').textContent = '⏹';
}

function stopRecording() {
  if (mediaRecorder && recording) {
    mediaRecorder.stop();
    recording = false;
    $('voiceBtn').textContent = '🎤';
  }
}
