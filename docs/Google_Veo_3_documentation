Veo on Vertex AI video generation API

bookmark_border
Release Notes
Veo is the name of the model that supports video generation. Veo generates a video from a text prompt or an image prompt that you provide. For more information about Veo, see Veo video generation overview.

To explore this model in the console, see the Video Generation model card in the Model Garden.

Try Veo on Vertex AI (Vertex AI Studio)

Try Veo in a Colab

Supported Models
Veo API supports the following models:

veo-2.0-generate-001
veo-2.0-generate-exp
veo-2.0-generate-preview
veo-3.0-generate-001
veo-3.0-fast-generate-001
veo-3.0-generate-001
veo-3.0-fast-generate-001
veo-3.1-generate-preview (Preview)
veo-3.1-fast-generate-preview (Preview)
For more information, see Veo models.

HTTP request


curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/publishers/google/models/MODEL_ID:predictLongRunning \

-d '{
  "instances": [
    {
      "prompt": string,
      "image": {
        // Union field can be only one of the following:
        "bytesBase64Encoded": string,
        "gcsUri": string,
        // End of list of possible types for union field.
        "mimeType": string
      },
      "lastFrame": {
        // Union field can be only one of the following:
        "bytesBase64Encoded": string,
        "gcsUri": string,
        // End of list of possible types for union field.
        "mimeType": string
      },
      "video": {
        // Union field can be only one of the following:
        "bytesBase64Encoded": string,
        "gcsUri": string,
        // End of list of possible types for union field.
        "mimeType": string
      },
      "mask": {
        // Union field can be only one of the following:
        "bytesBase64Encoded": string,
        "gcsUri": string,
        // End of list of possible types for union field.
        "mimeType": string,
        "maskMode": string
      },
      "referenceImages": [
        // A list of up to three asset images or at most one style image for the
        // model to use when generating videos.
        //
        // referenceImages is supported by the following models in Preview:
        //
        // *   veo-2.0-generate-exp
        // *   veo-3.1-generate-preview
        {
        "image:" {
          // Union field can be only one of the following:
          "bytesBase64Encoded": string,
          "gcsUri": string,
          // End of list of possible types for union field.
          "mimeType": string
        },
        "referenceType": string
        }
      ]
    }
  ],
  "parameters": {
    "aspectRatio": string,
    "compressionQuality": string,
    "durationSeconds": integer,
    "enhancePrompt": boolean,
    "generateAudio": boolean,
    "negativePrompt": string,
    "personGeneration": string,
    "resizeMode": string, // Veo 3 image-to-video only
    "resolution": string, // Veo 3 models only
    "sampleCount": integer,
    "seed": uint32,
    "storageUri": string
  }
}'
Instances
Instances
prompt

string

Required for text-to-video.
Optional if an input image prompt is provided (image-to-video).

A text string to guide the first eight seconds in the video. For example:

A fast-tracking shot through a bustling dystopian sprawl with bright neon signs, flying cars and mist, night, lens flare, volumetric lighting
A neon hologram of a car driving at top speed, speed of light, cinematic, incredible details, volumetric lighting
Many spotted jellyfish pulsating under water. Their bodies are transparent and glowing in deep ocean
extreme close-up with a shallow depth of field of a puddle in a street. reflecting a busy futuristic Tokyo city with bright neon signs, night, lens flare
Timelapse of the northern lights dancing across the Arctic sky, stars twinkling, snow-covered landscape
A lone cowboy rides his horse across an open plain at beautiful sunset, soft light, warm colors
image	
Union field

Optional. An image to guide video generation, which can be either a bytesBase64Encoded string that encodes an image or a gcsUri string URI to a Cloud Storage bucket location.

lastFrame	
Union field

Optional. An image of the first frame of a video to fill the space between. lastFrame can be either a bytesBase64Encoded string that encodes an image or a gcsUri string URI to a Cloud Storage bucket location.

lastFrame is supported by the following models in Preview:

veo-2.0-generate-001
veo-3.0-generate-exp
veo-3.1-generate-preview
veo-3.1-fast-generate-preview
video	
Union field

Optional. A Veo generated video to extend in length, which can be either a bytesBase64Encoded string that encodes a video or a gcsUri string URI to a Cloud Storage bucket location.

video is supported by the following models in Preview:

veo-2.0-generate-001
veo-3.0-generate-exp
mask	
Union field

Optional. An image of a mask to apply to a video to add or remove an object from a video. mask can be either a bytesBase64Encoded string that encodes an image or a gcsUri string URI to a Cloud Storage bucket location.

mask is supported by veo-2.0-generate-preview in Preview.

referenceImages	
list[referenceImages]

Optional. A list of up to three asset images or at most one style images that describes the referenceImages for the model to use when generating videos.

Important: Veo 3.1 models don't support referenceImages.style. Use veo-2.0-generate-exp when using style images.
referenceImages is supported by the following models in Preview:

veo-2.0-generate-exp
veo-3.1-generate-preview
referenceImages.image	
Union field

Optional. Contains the reference images for veo-2.0-generate-exp to use as subject matter input. Each image can be either a bytesBase64Encoded string that encodes an image or a gcsUri string URI to a Cloud Storage bucket location.

referenceImages.referenceType	
string

Required in a referenceImages object. Specifies the type of reference image provided. The following values are supported:

"asset": The reference image provides assets for the generated video, such as: the scene, an object, or a character.
"style": The reference image provides style information for the generated videos, such as: scene colors, lighting, or texture.

Important: Veo 3.1 models don't support referenceImages.style. Use veo-2.0-generate-exp when using style images.
bytesBase64Encoded	
string

A bytes base64-encoded string of an image or video file. Used with the following objects:

image
video
lastFrame
referenceImages.image
gcsUri	
string

A string URI to a Cloud Storage bucket location. Used with the following objects:

image
video
lastFrame
referenceImages.image
mimeType	
string

Required for the following objects:

image
video
mask
lastFrame
referenceImages.image
Specifies the mime type of a video or image.

For images, the following mime types are accepted:

image/jpeg
image/png
image/webp
For videos, the following mime types are accepted:

video/mov
video/mpeg
video/mp4
video/mpg
video/avi
video/wmv
video/mpegps
video/flv
Parameters
Parameters
aspectRatio	
string

Optional. Specifies the aspect ratio of generated videos. The following are accepted values:

"16:9"
"9:16"
The default value is "16:9".

compressionQuality	
string

Optional. Specifies the compression quality of the generated videos. The accepted values are "optimized" or "lossless".

The devault is "optimized".

durationSeconds	
integer

Required. The length in seconds of video files that you want to generate.

The following are the accepted values:

Veo 2 models: 5-8. The default is 8.
Veo 3 models: 4,6, or 8. The default is 8.
When using referenceImages: 8.
For more information, see Veo models.

enhancePrompt	
boolean

Optional. Use Gemini to enhance your prompts. Accepted values are true or false. The default value is true.

generateAudio	
boolean

Required for Veo 3 models. Generate audio for the video. Accepted values are true or false.

generateAudio isn't supported by veo-2.0-generate-001 or veo-2.0-generate-exp.

For more information about available Veo models, see Veo models.

negativePrompt	
string

Optional. A text string that describes anything you want to discourage the model from generating. For example:

overhead lighting, bright colors
people, animals
multiple cars, wind
personGeneration	
string

Optional. The safety setting that controls whether people or face generation is allowed. One of the following:

"allow_adult" (default value): allow generation of adults only
"dont_allow": disallows inclusion of people/faces in images
resizeMode	
string

Optional. Veo 3 models only, used with image for image-to-video. The resize mode that the model uses to resize the video. Accepted values are "pad" (default) or "crop".

resolution	
string

Optional. Veo 3 models only. The resolution of the generated video. Accepted values are "720p" (default) or "1080p".

sampleCount	
int

Optional. The number of output videos requested. Accepted values are 1-4.

seed	
uint32

Optional. A number to request to make generated videos deterministic. Adding a seed number with your request without changing other parameters will cause the model to produce the same videos.

The accepted range is 0-4,294,967,295.

storageUri	
string

Optional. A Cloud Storage bucket URI to store the output video, in the format gs://BUCKET_NAME/SUBDIRECTORY. If a Cloud Storage bucket isn't provided, base64-encoded video bytes are returned in the response.

Sample requests
Use the following examples to create your own video request:

Text-to-video generation request
REST
To test a text prompt by using the Vertex AI Veo API, send a POST request to the publisher model endpoint.

Before using any of the request data, make the following replacements:

PROJECT_ID: A string representing your Google Cloud project ID.
MODEL_ID: A string respresenting the model ID to use. The following are accepted values:
Veo 2: "veo-2.0-generate-001"
Veo 3:"veo-3.0-generate-001"
Veo 3:"veo-3.0-fast-generate-001"
Veo 3:"veo-3.0-generate-preview" (Preview)
Veo 3:"veo-3.0-fast-generate-preview" (Preview)
Veo 3.1: "veo-3.1-generate-preview"
Veo 3.1: "veo-3.1-fast-generate-preview"
TEXT_PROMPT: The text prompt used to guide video generation.
OUTPUT_STORAGE_URI: Optional: A string representing the Cloud Storage bucket to store the output videos. If not provided, video bytes are returned in the response. For example: "gs://video-bucket/output/".
RESPONSE_COUNT: The number of video files to generate. The accepted range of values is 1-4.
DURATION: An integer representing the length of the generated video files. The following are the accepted values for each model:
Veo 2 models: 5-8. The default is 8.
Veo 3 models: 4, 6, or 8. The default is 8.
Additional optional parameters

HTTP method and URL:



POST https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning
Request JSON body:



{
  "instances": [
    {
      "prompt": "TEXT_PROMPT"
    }
  ],
  "parameters": {
    "storageUri": "OUTPUT_STORAGE_URI",
    "sampleCount": "RESPONSE_COUNT"
  }
}
To send your request, choose one of these options:

curl
PowerShell
Note: The following command assumes that you have logged in to the gcloud CLI with your user account by running gcloud init or gcloud auth login , or by using Cloud Shell, which automatically logs you into the gcloud CLI . You can check the currently active account by running gcloud auth list.
Save the request body in a file named request.json, and execute the following command:



curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d @request.json \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning"
This request returns a full operation name with a unique operation ID. Use this full operation name to poll that status of the video generation request.

{
  "name": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/a1b07c8e-7b5a-4aba-bb34-3e1ccb8afcc8"
}
Image-to-video generation request
REST
To test a text prompt by using the Vertex AI Veo API, send a POST request to the publisher model endpoint.

Before using any of the request data, make the following replacements:

PROJECT_ID: A string representing your Google Cloud project ID.
MODEL_ID: A string respresenting the model ID to use. The following are accepted values:
Veo 2:veo-2.0-generate-001
Veo 3:veo-3.0-generate-001
Veo 3.1:veo-3.1-generate-preview
Veo 3.1:veo-3.1-fast-generate-preview
TEXT_PROMPT: The text prompt used to guide video generation.
INPUT_IMAGE: A base64-encoded string that represents the input image. For best quality, we recommend that the input image's resolution be 720p (1280 x 720 pixels) or higher, and have an aspect ratio of either 16:9 or 9:16. Images of other aspect ratios or sizes may be resized or centrally cropped when the image is uploaded.
MIME_TYPE: A string representing the MIME type of the input image. Only the images of the following MIME types are supported:
"image/jpeg"
"image/png"
OUTPUT_STORAGE_URI: Optional: A string representing the Cloud Storage bucket to store the output videos. If not provided, video bytes are returned in the response. For example: "gs://video-bucket/output/".
RESIZE_MODE: A string that represents the resize mode to use. The following are accepted values:
"crop": Crop the video to fit the new size.
"pad": Pad the video to fit the new size.
RESPONSE_COUNT: The number of video files to generate. The accepted range of values is 1-4.
DURATION: An integer representing the length of the generated video files. The following are the accepted values for each model:
Veo 2 models: 5-8. The default is 8.
Veo 3 models: 4, 6, or 8. The default is 8.
Additional optional parameters

HTTP method and URL:



POST https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning
Request JSON body:



{
  "instances": [
    {
      "prompt": "TEXT_PROMPT",
      "image": {
        "bytesBase64Encoded": "INPUT_IMAGE",
        "mimeType": "MIME_TYPE"
      }
    }
  ],
  "parameters": {
    "storageUri": "OUTPUT_STORAGE_URI",
    "sampleCount": RESPONSE_COUNT
    "resizeMode": "RESIZE_MODE"
  }
}
To send your request, choose one of these options:

curl
PowerShell
Note: The following command assumes that you have logged in to the gcloud CLI with your user account by running gcloud init or gcloud auth login , or by using Cloud Shell, which automatically logs you into the gcloud CLI . You can check the currently active account by running gcloud auth list.
Save the request body in a file named request.json, and execute the following command:



curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d @request.json \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning"
This request returns a full operation name with a unique operation ID. Use this full operation name to poll that status of the video generation request.

{
  "name": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/a1b07c8e-7b5a-4aba-bb34-3e1ccb8afcc8"
}
Video request using asset images
REST
To test a text prompt by using the Vertex AI Veo API, send a POST request to the publisher model endpoint.

Before using any of the request data, make the following replacements:

PROJECT_ID: Your Google Cloud project ID.
MODEL_ID: A string representing the model ID to use. The following are accepted values:
Veo 2: veo-2.0-generate-exp
Veo 3: veo-3.1-generate-preview
TEXT_PROMPT: The text prompt used to guide video generation.
BASE64_ENCODED_IMAGE: A base64-bytes encoded subject image. You can repeat this field and mimeType to specify up to three subject images.
IMAGE_MIME_TYPE: The MIME type of the input image. Only one of the following:

image/jpeg
image/png
You can repeat this field and bytesBase64Encoded to specify up to three subject images.

OUTPUT_STORAGE_URI: Optional: The Cloud Storage bucket to store the output videos. If not provided, a Base64-bytes encoded video is returned in the response. For example: gs://video-bucket/output/.
RESPONSE_COUNT: The number of video files you want to generate. Accepted integer values: 1-4.
Additional optional parameters

HTTP method and URL:



POST https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning
Request JSON body:



{
  "instances": [
    {
      "prompt": "TEXT_PROMPT",
      // The following fields can be repeated for up to three total
      // images.
      "referenceImages": [
        {
          "image": {
            "bytesBase64Encoded": "BASE64_ENCODED_IMAGE",
            "mimeType": "IMAGE_MIME_TYPE"
          },
          "referenceType": "asset"
        }
      ]
    }
  ],
  "parameters": {
    "durationSeconds": 8,
    "storageUri": "OUTPUT_STORAGE_URI",
    "sampleCount": RESPONSE_COUNT
  }
}
To send your request, choose one of these options:

curl
PowerShell
Note: The following command assumes that you have logged in to the gcloud CLI with your user account by running gcloud init or gcloud auth login , or by using Cloud Shell, which automatically logs you into the gcloud CLI . You can check the currently active account by running gcloud auth list.
Save the request body in a file named request.json, and execute the following command:



curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d @request.json \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning"
This request returns a full operation name with a unique operation ID. Use this full operation name to poll that status of the video generation request.

{
  "name":
  "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/a1b07c8e-7b5a-4aba-bb34-3e1ccb8afcc8"
}
Video request using a style image
REST
To test a text prompt by using the Vertex AI Veo API, send a POST request to the publisher model endpoint.

Before using any of the request data, make the following replacements:

PROJECT_ID: Your Google Cloud project ID.
MODEL_ID: A string representing the model ID to use. Use the following value: veo-2.0-generate-exp.

Important: Veo 3.1 models don't support referenceImages.style. Use veo-2.0-generate-exp when using style images.
TEXT_PROMPT: The text prompt used to guide video generation.
BASE64_ENCODED_IMAGE: A base64-bytes encoded style image.
IMAGE_MIME_TYPE: The MIME type of the input image. Only one of the following:
image/jpeg
image/png
OUTPUT_STORAGE_URI: Optional: The Cloud Storage bucket to store the output videos. If not provided, video bytes are returned in the response. For example: gs://video-bucket/output/.
RESPONSE_COUNT: The number of video files you want to generate. Accepted integer values: 1-4.
Additional optional parameters

HTTP method and URL:



POST https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning
Request JSON body:



{
  "instances": [
    {
      "prompt": "TEXT_PROMPT",
      "referenceImages": [
        {
          "image": {
            "bytesBase64Encoded": "BASE64_ENCODED_IMAGE",
            "mimeType": "IMAGE_MIME_TYPE"
          },
          "referenceType": "style"
        }
      ]
    }
  ],
  "parameters": {
    "durationSeconds": 8,
    "storageUri": "OUTPUT_STORAGE_URI",
    "sampleCount": RESPONSE_COUNT
  }
}
To send your request, choose one of these options:

curl
PowerShell
Note: The following command assumes that you have logged in to the gcloud CLI with your user account by running gcloud init or gcloud auth login , or by using Cloud Shell, which automatically logs you into the gcloud CLI . You can check the currently active account by running gcloud auth list.
Save the request body in a file named request.json, and execute the following command:



curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d @request.json \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:predictLongRunning"
This request returns a full operation name with a unique operation ID. Use this full operation name to poll that status of the video generation request.

{
  "name":
  "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/a1b07c8e-7b5a-4aba-bb34-3e1ccb8afcc8"
}
Poll the status of the video generation long-running operation
Check the status of the video generation long-running operation.

REST

Before using any of the request data, make the following replacements:

PROJECT_ID: Your Google Cloud project ID.
MODEL_ID: The model ID to use.
OPERATION_ID: The unique operation ID returned in the original generate video request.
HTTP method and URL:



POST https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:fetchPredictOperation
Request JSON body:



{
  "operationName": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/OPERATION_ID"
}
To send your request, choose one of these options:

curl
PowerShell
Note: The following command assumes that you have logged in to the gcloud CLI with your user account by running gcloud init or gcloud auth login , or by using Cloud Shell, which automatically logs you into the gcloud CLI . You can check the currently active account by running gcloud auth list.
Save the request body in a file named request.json, and execute the following command:



curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d @request.json \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID:fetchPredictOperation"
This request returns information about the operation, including if the operation is still running or is done.
Response
Response body (generate video request)
Sending a text-to-video or image-to-video request returns the following response:



{
  "name": string
}
Response element	Description
name	The full operation name of the long-running operation that begins after a video generation request is sent.
Sample response (generate video request)


{
  "name": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/OPERATION_ID"
}
Response body (poll long-running operation)
Polling the status of the original video generation long-running operation returns a response similar to the following:



{
   "name": string,
   "done": boolean,
   "response":{
      "@type":"type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse",
      "raiMediaFilteredCount": integer,
      "videos":[
         {
           "gcsUri": string,
           "mimeType": string
         },
         {
           "gcsUri": string,
           "mimeType": string
         },
         {
           "gcsUri": string,
           "mimeType": string
         },
         {
           "gcsUri": string,
           "mimeType": string
         },
      ]
   }
}
Note: If you didn't specify a Cloud Storage bucket URI in storageUri, then the videos object returns bytesBase64Encoded strings.
Response element	Description
bytesBase64Encoded	A Base64 bytes encoded string that represents the video object.
done	A boolean value that indicates whether the operation is complete.
encoding	The video encoding type.
gcsUri	The Cloud Storage URI of the generated video.
name	The full operation name of the long-running operation that begins after a video generation request is sent.
raiMediaFilteredCount	Returns a count of videos that Veo filtered due to responsible AI policies. If no videos are filtered, the returned count is 0.
raiMediaFilteredReasons	Lists the reasons for any Veo filtered videos due to responsible AI policies. For more information, see Safety filter code categories.
response	The response body of the long-running operation.
video	The generated video.
Sample response (poll long-running operation)


{
   "name": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/MODEL_ID/operations/OPERATION_ID",
   "done":true,
   "response":{
      "@type":"type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse",
      "raiMediaFilteredCount": 0,
      "videos":[
        {
          "gcsUri":"gs://STORAGE_BUCKET/TIMESTAMPED_SUBDIRECTORY/sample_0.mp4",
          "mimeType":"video/mp4"
        },
        {
          "gcsUri":"gs://STORAGE_BUCKET/TIMESTAMPED_SUBDIRECTORY/sample_1.mp4",
          "mimeType":"video/mp4"
        },
        {
          "gcsUri":"gs://STORAGE_BUCKET/TIMESTAMPED_SUBDIRECTORY/sample_2.mp4",
          "mimeType":"video/mp4"
        },
        {
          "gcsUri":"gs://STORAGE_BUCKET/TIMESTAMPED_SUBDIRECTORY/sample_3.mp4",
          "mimeType":"video/mp4"
        }
      ]
   }
}