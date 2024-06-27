const express = require('express');
const multer = require('multer');
const { Configuration, OpenAIApi, default: OpenAI } = require('openai');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const vision = require('@google-cloud/vision');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
const visionClient = new vision.ImageAnnotatorClient();

// Set up OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY 
});

const CREDENTIALS_PATH = 'path/client_secret_11099880540-oeltnbltlo11maul65vd7cr3qjs9ft0k.apps.googleusercontent.com.json';
  const TOKEN_PATH = '/path/token.json';

app.post('/upload', upload.single('file'), async (req, res) => {
    const filePath = req.file.path;
    const topics = req.body.topics;
    console.log(`Received file: ${filePath}`);
    console.log(`Received topics: ${topics}`);

    // Perform text detection on the image
    const [result] = await visionClient.textDetection(filePath);
    const detections = result.textAnnotations;
    const detectedText = detections.length > 0 ? detections[0].description : '';
    console.log('Detected text:', detectedText);

    // Define the extractPrompt
    const extractPrompt = `
Extract the assignment titles and due dates from the following text. Format each extracted item as "Title - Due Date (YYYY-MM-DD)":

${detectedText}
`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: extractPrompt }],
    });
        const extractedEvents = completion.choices[0].message.content.trim();
        console.log('Extracted events from GPT:', extractedEvents);

        const events = extractedEvents
            .split('\n')
            .map(line => {
                const parts = line.split(' - ');
                if (parts.length === 2) {
                    return { summary: parts[0].trim(), dueDate: parts[1].trim() };
                }
                return null;
            })
            .filter(event => event !== null);

        if (events.length === 0) {
            console.log('No valid events found.');
            res.status(400).send('No valid events found.');
            return;
        }

        console.log('Parsed events:', events);

        // Generate study plan using GPT-4 based on topics and events
        const studyPlanPrompt = `
Generate a 7-day detailed study plan for the following topics and dates:
Topics: ${topics}
Events: ${events.map(event => `${event.summary} due on ${event.dueDate}`).join(', ')}

Format:
Date: Study Activity
`;

        const studyPlanCompletion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: studyPlanPrompt }],
        });
        const studyPlan = studyPlanCompletion.choices[0].message.content.trim();
        console.log('Generated study plan from GPT:', studyPlan);

        // Generate practice problems using GPT-4 based on topics
        const practiceProblemPrompt = `
Generate a set of practice problems for the following topic: ${topics}. Provide detailed solutions for each problem.
`;

        const practiceProblemsCompletion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: practiceProblemPrompt }],
        });
        const practiceProblems = practiceProblemsCompletion.choices[0].message.content.trim();
        console.log('Generated practice problems from GPT:', practiceProblems);

        // Load credentials and add events to Google Calendar
        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        authorize(credentials, (auth) => {
            addEventsToCalendar(auth, events)
                .then(() => res.send(`Events and study plan added to calendar successfully:\n\n${studyPlan}\n\nPractice Problems:\n\n${practiceProblems}`))
                .catch(err => {
                    console.error('Error adding events to calendar:', err);
                    res.status(500).send('Error adding events to calendar');
                });
        });
    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).send(`Error processing image: ${error.message}`);
    } finally {
        fs.unlinkSync(filePath); // Clean up the uploaded file
    }
});

function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH, 'utf8');
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    } else {
        getNewToken(oAuth2Client, callback);
    }
}

function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
            callback(oAuth2Client);
        });
    });
}

async function addEventsToCalendar(auth, events) {
    const calendar = google.calendar({ version: 'v3', auth });
    for (const event of events) {
        const eventDate = new Date(event.dueDate);
        if (isNaN(eventDate.getTime())) {
            console.error(`Invalid date parsed: ${event.dueDate}`);
            continue;
        }
        const formattedDate = eventDate.toISOString().split('T')[0]; // Get date in YYYY-MM-DD format
        const calendarEvent = {
            summary: event.summary,
            start: { date: formattedDate },
            end: { date: formattedDate },
        };
        await calendar.events.insert({
            calendarId: 'primary',
            resource: calendarEvent,
        });
        console.log(`Event created: ${event.summary} on ${formattedDate}`);
    }
}

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
