import { v1p1beta1 as speech } from "@google-cloud/speech";
import { Writable } from "stream";
import { io } from ".";
import recorder from 'node-record-lpcm16';
import credentials from './recorder_keys.json';

type RecognizeStream = ReturnType<typeof speech.SpeechClient.prototype.streamingRecognize>;


export function record () {
  const client = new speech.SpeechClient({
    credentials
  })

  const sampleRateHertz = 16000;

  const config = {
    encoding: 'LINEAR16',
    sampleRateHertz: sampleRateHertz,
    languageCode: 'pt-BR',
  } as const;

  const request = {
    config,
    interimResults: true,
  };

  const streamingLimit = 290000; // ~5 minutes
  let recognizeStream: RecognizeStream | null = null;
  let restartCounter = 0;
  let audioInput: Buffer[] = [];
  let lastAudioInput: Buffer[] = [];
  let resultEndTime = 0;
  let isFinalEndTime = 0;
  let finalRequestEndTime = 0;
  let newStream = true;
  let bridgingOffset = 0;
  let lastTranscriptWasFinal = false;

  function startStream() {
    // Clear current audioInput
    audioInput = [];
    // Initiate (Reinitiate) a recognize stream
    recognizeStream = client
      .streamingRecognize(request)
      .on('error', err => {
        console.error('API request error ' + err);
      })
      .on('data', speechCallback);

    // Restart stream when streamingLimit expires
    setTimeout(restartStream, streamingLimit);
  }

  const emitTranscript = (transcript: string) => {
    io.emit('transcript', transcript);
  }

  const speechCallback = (stream: any) => {
    // Convert API result end time from seconds + nanoseconds to milliseconds
    resultEndTime =
      stream.results[0].resultEndTime.seconds * 1000 +
      Math.round(stream.results[0].resultEndTime.nanos / 1000000);

    // Calculate correct time based on offset from audio sent twice
    const correctedTime =
      resultEndTime - bridgingOffset + streamingLimit * restartCounter;

    let stdoutText = '';
    if (stream.results[0] && stream.results[0].alternatives[0]) {
      stdoutText =
        correctedTime + ': ' + stream.results[0].alternatives[0].transcript;
    }

    if (stream.results[0].isFinal) {
      emitTranscript(stdoutText);

      isFinalEndTime = resultEndTime;
      lastTranscriptWasFinal = true;
    } else {
      lastTranscriptWasFinal = false;
    }
  };

  const audioInputStreamTransform = new Writable({
    write(chunk, encoding, next) {
      if (newStream && lastAudioInput.length !== 0) {
        // Approximate math to calculate time of chunks
        const chunkTime = streamingLimit / lastAudioInput.length;
        if (chunkTime !== 0) {
          if (bridgingOffset < 0) {
            bridgingOffset = 0;
          }
          if (bridgingOffset > finalRequestEndTime) {
            bridgingOffset = finalRequestEndTime;
          }
          const chunksFromMS = Math.floor(
            (finalRequestEndTime - bridgingOffset) / chunkTime
          );
          bridgingOffset = Math.floor(
            (lastAudioInput.length - chunksFromMS) * chunkTime
          );

          for (let i = chunksFromMS; i < lastAudioInput.length; i++) {
            if (recognizeStream) {
              recognizeStream.write(lastAudioInput[i]);
            }
          }
        }
        newStream = false;
      }

      audioInput.push(chunk);

      if (recognizeStream) {
        recognizeStream.write(chunk);
      }

      next();
    },

    final() {
      if (recognizeStream) {
        recognizeStream.end();
      }
    },
  });

  function restartStream() {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream.removeListener('data', speechCallback);
      recognizeStream = null;
    }
    if (resultEndTime > 0) {
      finalRequestEndTime = isFinalEndTime;
    }
    resultEndTime = 0;

    lastAudioInput = [];
    lastAudioInput = audioInput;

    restartCounter++;
    
    console.log(`${streamingLimit * restartCounter}: RESTARTING REQUEST\n`)

    newStream = true;

    startStream();
  }
  // Start recording and send the microphone input to the Speech API
  recorder
    .record({
      rateHertz: sampleRateHertz,
      threshold: 0, // Silence threshold
      keepSilence: true,
      recordProgram: 'rec', // Try also "arecord" or "sox"
    })
    .stream()
    .on('error', (err: any) => {
      console.error('Audio recording error ' + err);
    })
    .pipe(audioInputStreamTransform);

  console.log('');
  console.log('Listening, press Ctrl+C to stop.');
  console.log('');
  console.log('End (ms)       Transcript Results/Status');
  console.log('=========================================================');

  startStream();
}
