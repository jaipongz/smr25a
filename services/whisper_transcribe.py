#!/usr/bin/env python3
import sys
import json
import whisper
import os
from pathlib import Path

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "ต้องระบุ path ของไฟล์เสียงและภาษา"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    language = sys.argv[2]
    
    # ตรวจสอบว่าไฟล์มีอยู่จริง
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"ไม่พบไฟล์เสียง: {audio_path}"}))
        sys.exit(1)
    
    try:
        # โหลดโมเดล (ใช้ base model สำหรับความเร็ว)
        print("กำลังโหลด Whisper model...", file=sys.stderr)
        model = whisper.load_model("base")
        
        # ตั้งค่าสำหรับการแปลงเสียง
        options = {
            "language": language,
            "task": "transcribe",
            "fp16": False
        }
        
        print(f"กำลังแปลงเสียง: {audio_path}", file=sys.stderr)
        result = model.transcribe(audio_path, **options)
        
        # ส่งผลลัพธ์กลับเป็น JSON
        output = {
            "success": True,
            "text": result["text"].strip(),
            "language": result["language"],
            "duration": result["segments"][-1]["end"] if result["segments"] else 0
        }
        
        print(json.dumps(output))
        
    except Exception as e:
        error_output = {
            "error": f"การแปลงเสียงล้มเหลว: {str(e)}"
        }
        print(json.dumps(error_output))
        sys.exit(1)

if __name__ == "__main__":
    main()