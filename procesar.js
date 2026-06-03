import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const form = new IncomingForm({ maxFileSize: 10 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Error al procesar el formulario: ' + err.message });

    const empresa    = (fields.empresa?.[0] || fields.empresa || '').trim();
    const tipoEquipo = (fields.tipo_equipo?.[0] || fields.tipo_equipo || '').trim();
    const archivo    = files.pdf?.[0] || files.pdf;

    if (!empresa || !tipoEquipo) return res.status(400).json({ error: 'Faltan datos del formulario' });
    if (!archivo) return res.status(400).json({ error: 'No se recibió el archivo PDF' });

    const pdfBuffer = fs.readFileSync(archivo.filepath);
    const pdfBase64 = pdfBuffer.toString('base64');

    const prompt = `Sos un experto en mantenimiento industrial. Analizá este manual técnico y generá un plan de mantenimiento preventivo completo.

EMPRESA: ${empresa}
TIPO DE EQUIPO: ${tipoEquipo}

Respondé ÚNICAMENTE con un JSON válido, sin markdown, sin texto adicional, sin backticks. Estructura exacta:

{"checklist":{"Diario":["tarea 1","tarea 2"],"Semanal":["tarea 1","tarea 2"],"Mensual":["tarea 1","tarea 2"],"Trimestral":["tarea 1"],"Semestral":["tarea 1"],"Anual":["tarea 1","tarea 2"]},"insumos":[{"nombre":"nombre del insumo","frecuencia":"cada cuánto","prioridad":"Alta|Media|Baja","observaciones":"nota"}],"resumen":"párrafo ejecutivo de 3-5 oraciones con puntos críticos y vida útil estimada"}

Reglas:
- Todo en ESPAÑOL claro para el técnico de planta
- Mínimo 3 tareas por frecuencia cuando aplique
- Si una frecuencia no aplica, dejá el array vacío []
- Insumos específicos según el manual, no genéricos`;

    const requestBody = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
          { text: prompt }
        ]
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
    };

    try {
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
      );

      if (!apiRes.ok) {
        const errData = await apiRes.json();
        return res.status(500).json({ error: 'Error de API: ' + (errData.error?.message || apiRes.status) });
      }

      const data = await apiRes.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Limpiar markdown
      text = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/,'').trim();

      let plan = null;
      try { plan = JSON.parse(text); } catch {
        const match = text.match(/\{.*\}/s);
        if (match) plan = JSON.parse(match[0]);
      }

      if (!plan) return res.status(500).json({ error: 'No se pudo interpretar la respuesta. Probá con un manual más completo.' });

      return res.status(200).json(plan);

    } catch (e) {
      return res.status(500).json({ error: 'Error de conexión: ' + e.message });
    }
  });
}
