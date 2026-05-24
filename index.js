const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

dotenv.config();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'cef_token_2025';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const MI_NUMERO = '5493426503812';

async function enviarMensaje(telefono, texto) {
  await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: telefono,
    type: 'text',
    text: { body: texto }
  }, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
}

async function consultarCuotas(dni, telefono) {
  const alumnosSnap = await db.collection('alumnos').where('dni', '==', dni).get();
  if (alumnosSnap.empty) {
    await enviarMensaje(telefono, '❌ No encontré ningún alumno con ese DNI. Verificá el número e intentá de nuevo.');
    return;
  }

  const alumno = alumnosSnap.docs[0].data();
  const nombre = alumno.nombreCompleto;
  const grado = alumno.grado;
  const turno = alumno.turno;

  const meses = ['Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre'];
  let respuesta = `📋 *${nombre}*\n${grado} - Turno ${turno}\n\n*Estado de cuotas 2026:*\n`;

  for (const mes of meses) {
    const mesKey = `2026-${String(meses.indexOf(mes) + 3).padStart(2,'0')}`;
    const cuotaDoc = await db.collection('cuotas').doc(mesKey).collection('alumnos').doc(dni).get();
    if (cuotaDoc.exists && cuotaDoc.data().pagado) {
      respuesta += `✅ ${mes} - Pagado\n`;
    } else {
      respuesta += `⏳ ${mes} - Pendiente $35.000\n`;
    }
  }

  await enviarMensaje(telefono, respuesta);

  // Notificación a Juan Pablo
  try {
    await enviarMensaje(MI_NUMERO, `📬 *Consulta recibida*\nPadre: +${telefono}\nAlumno: ${nombre}\nGrado: ${grado} - ${turno}`);
  } catch (e) {
    console.error('Error enviando notificación:', e.message);
  }
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object !== 'whatsapp_business_account') {
    res.sendStatus(200);
    return;
  }

  const entry = body.entry?.[0]?.changes?.[0]?.value;
  const mensaje = entry?.messages?.[0];

  if (!mensaje || mensaje.type !== 'text') {
    res.sendStatus(200);
    return;
  }

  const telefono = mensaje.from;
  const texto = mensaje.text.body.trim();
  const esDNI = /^\d{7,8}$/.test(texto);

  try {
    if (esDNI) {
      await consultarCuotas(texto, telefono);
    } else {
      await enviarMensaje(telefono, '👋 Hola! Soy el bot de cuotas del CEF San Francisco.\n\nEnviá el *DNI del alumno* para consultar el estado de sus cuotas.');
    }
  } catch (e) {
    console.error('Error procesando mensaje:', e.message);
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));