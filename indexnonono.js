const express = require('express');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

const client = new vision.ImageAnnotatorClient();

app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('File uploaded:', req.file.path);
    const [result] = await client.textDetection(req.file.path);
    const detections = result.textAnnotations;
    console.log('Text detections:', detections);

    // Extract title and due date from detections
    const events = parseText(detections[0].description);
    console.log('Parsed events:', events);

    // Add events to Google Calendar
    const response = await addEventsToCalendar(events);
    console.log('Google Calendar API response:', response);

    res.send('Events added to calendar');
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).send('Error processing image');
  }
});

function parseText(text) {
  const lines = text.split('\n');
  const events = [];

  lines.forEach(line => {
    console.log('Processing line:', line); // Add this line for debugging
    const match = line.match(/(.+)\s+due\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (match) {
      const summary = match[1].trim();
      const dueDateStr = match[2];
      console.log('Matched summary:', summary); // Add this line for debugging
      console.log('Matched dueDateStr:', dueDateStr); // Add this line for debugging
      
      // Parse the due date string into a Date object
      const [month, day, year] = dueDateStr.split('/');
      const dateObj = new Date(year, month - 1, day);

      if (!isNaN(dateObj.getTime())) {
        events.push({
          summary,
          dueDate: dateObj,
        });
      } else {
        console.error('Invalid date parsed:', dueDateStr);
      }
    }
  });

  return events;
}

async function addEventsToCalendar(events) {
  try {
    const credentialsPath = '/Users/bhavyabakshi/Downloads/calendar-importer/client_secret_11099880540-oeltnbltlo11maul65vd7cr3qjs9ft0k.apps.googleusercontent.com.json';
    console.log('Google Calendar Credentials Path:', credentialsPath);
    const credentials = JSON.parse(fs.readFileSync(credentialsPath));
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const tokenPath = path.join(__dirname, 'token.json');
    console.log('Token Path:', tokenPath);
    const token = JSON.parse(fs.readFileSync(tokenPath));
    oAuth2Client.setCredentials(token);

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    let responses = [];
    for (const event of events) {
      const eventDetails = {
        summary: event.summary,
        start: {
          date: event.dueDate.toISOString().split('T')[0],
          timeZone: 'America/Los_Angeles',
        },
        end: {
          date: event.dueDate.toISOString().split('T')[0],
          timeZone: 'America/Los_Angeles',
        },
      };

      const response = await calendar.events.insert({
        auth: oAuth2Client,
        calendarId: 'primary',
        resource: eventDetails,
      });
      responses.push(response.data);
    }
    return responses;
  } catch (error) {
    console.error('Error adding events to calendar:', error);
    throw error;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
