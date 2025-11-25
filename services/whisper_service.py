import sys
import json
import whisper
import tempfile
import os
from pathlib import Path

class WhisperService:
    def __init__(self):
        self.model = None
        self.model_loaded = False
    
    def load_model(self, model_size="base"):
        """โหลด Whisper model"""
        try:
            print(f"กำลังโหลด Whisper model ({model_size})...")
            self.model = whisper.load_model(model_size)
            self.model_loaded = True
            print("โหลด Whisper model สำเร็จ!")
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
    
    def transcribe_audio(self, audio_path, language="th"):
        """แปลงเสียงเป็นข้อความ"""
        if not self.model_loaded:
            if not self.load_model():
                return {"error": "ไม่สามารถโหลดโมเดลได้"}
        
        try:
            print(f"กำลังแปลงเสียง: {audio_path}")
            
            # ตั้งค่า options สำหรับภาษาไทย
            options = {
                "language": language,
                "task": "transcribe",
                "fp16": False  # ใช้ FP32 สำหรับความเข้ากันได้
            }
            
            # ทำการแปลงเสียงเป็นข้อความ
            result = self.model.transcribe(audio_path, **options)
            
            return {
                "success": True,
                "text": result["text"],
                "language": result["language"],
                "segments": result["segments"]
            }
            
        except Exception as e:
            print(f"Error transcribing audio: {e}")
            return {"error": f"การแปลงเสียงล้มเหลว: {str(e)}"}

# สำหรับการทดสอบ
if __name__ == "__main__":
    service = WhisperService()
    service.load_model()