import OpenAI from "openai";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { DataAPIClient } from "@datastax/astra-db-ts";

const {
    ASTRA_DB_NAMESPACE,
    ASTRA_DB_COLLECTION,
    ASTRA_DB_API_ENDPOINT,
    ASTRA_DB_APPLICATION_TOKEN,
    OPENAI_API_KEY,
} = process.env;

// Lazy initialization to avoid build-time errors
let openAI: OpenAI | null = null;
let client: DataAPIClient | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any | null = null;

function getOpenAI() {
    if (!openAI) {
        openAI = new OpenAI({
            apiKey: OPENAI_API_KEY!,
        });
    }
    return openAI;
}

function getDB() {
    if (!db) {
        client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN!);
        db = client.db(ASTRA_DB_API_ENDPOINT!, { namespace: ASTRA_DB_NAMESPACE });
    }
    return db;
}

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();
        const latestMessage = messages[messages.length - 1]?.content;
        
        if (!latestMessage) {
            return new Response('No message provided', { status: 400 });
        }
        
        console.log('Processing message:', latestMessage);

        let docContext = "";

        const embeddings = await getOpenAI().embeddings.create({
            model: "text-embedding-3-small",
            input: latestMessage,
            encoding_format: "float",
        });

        try {
            const collection = getDB().collection(ASTRA_DB_COLLECTION!);
            const cursor = collection.find(null, {
                sort: {
                    $vector: embeddings.data[0].embedding,
                },
                limit: 10,
            });

            const documents = await cursor.toArray();
            const docMap = documents.map((doc) => doc.text);
            docContext = JSON.stringify(docMap);
        } catch (err) {
            console.log("Error querying DB:", err);
            docContext = "";
        }

        const systemMessage = {
            role: "system" as const,
            content: `You are: an Expert AI College Transfer Counselor embedded in our student portal.
            Primary mission: design clear, personalized transfer roadmaps that guide community‑college 
            students from their current institution to a target 4‑year university and meeting all admission requirements.
            If the context doesn't include the information you need, ask for further details, and always say where the 
            source of your information is from.
            Your responses should be concise, actionable, and tailored to the student's specific situation.

            when listing course always list the Community college course required, and an arrow to what it transfer to, whith the full Community college course.
            Eg: (Math -04A Calculus 1 ——>  Math 1A Calculus )
            Eg: (MATH -06 Elementary Differential Equations and MATH -08 Linear Algebra ——>  Math 54 Linear Algebra and Differential Equations)
            
            START CONTEXT
            ___________________
            ${docContext}
            END CONTEXT
            ___________________
            
            QUESTION: ${latestMessage}
            ___________________
        `
        };
        const result = streamText({
            model: openai("gpt-4.1-nano-2025-04-14"),
            messages: [systemMessage, ...messages],
        });

        return result.toDataStreamResponse();
    } catch (err) {
        console.error('API Error:', err);
        return new Response('Internal server error', { status: 500 });
    }
}
