import base64
import json
import uuid
import requests
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

appid = os.getenv("BYTEPLUS_APP_ID")
access_token = os.getenv("BYTEPLUS_ACCESS_TOKEN")
cluster = "byteplus_tts"
voice_type = "BV027_streaming"
host = "openspeech.byteoversea.com"
api_url = f"https://{host}/api/v1/tts"

headers = {
    "Authorization": f"Bearer;{access_token}",
    "Content-Type": "application/json"
}

def test_field(field_name, test_value):
    print(f"\nTesting {field_name} with value: {test_value if test_value else '[actual value]'}")
    request_json = {
        "app": {
            "appid": appid if field_name != "appid" else test_value,
            "token": access_token if field_name != "token" else test_value,
            "cluster": cluster if field_name != "cluster" else test_value
        },
        "user": {
            "uid": "388808087185088"
        },
        "audio": {
            "voice": "other",
            "voice_type": voice_type,
            "encoding": "mp3",
            "speed": 10,
            "volume": 10,
            "pitch": 10
        },
        "request": {
            "reqid": str(uuid.uuid4()),
            "text": "Welcome to BytePlus Speech Synthesis!",
            "text_type": "plain",
            "operation": "query"
        }
    }
    print("Request JSON:", json.dumps(request_json, indent=2))
    resp = requests.post(api_url, json=request_json, headers=headers)
    print(f"Status code: {resp.status_code}")
    print(f"Response: {resp.text}")

if __name__ == '__main__':
    print("AppID:", appid)
    print("Access Token:", access_token)
    print("Cluster:", cluster)
    print("Headers:", headers)
    # Test with correct values
    print("\nTesting with correct values:")
    test_field("none", None)

    # Test with invalid appid
    test_field("appid", "INVALID_APPID")

    # Test with invalid token
    test_field("token", "INVALID_TOKEN")

    # Test with invalid cluster
    test_field("cluster", "INVALID_CLUSTER") 