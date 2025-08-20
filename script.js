// --- Global Variables ---
let videoElement;
let gl;
let grayscaleGl; // WebGL context for grayscale canvas
let detectionGl; // WebGL context for detection canvas
let programDifference;
let programCopy;
let programGrayscale; // New grayscale program
let programLaplacianGaussian; // LoG filter program
let currentTexture;
let previousTexture;
let grayscaleTexture; // Texture for grayscale canvas
let detectionTexture; // Texture for detection canvas
let framebuffer; // For offscreen rendering
let grayscaleVao; // VAO for grayscale canvas
let detectionVao; // VAO for detection canvas
let vao;
let lastFrameTime = 0;
let DELAY_MS = 1000; // 1 second delay
let isStarted = false; // Added: prevent multiple starts
let useGrayscaleForDetection = true; // New: toggle between grayscale and difference input

// --- Helper Functions (Simplified) ---
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function setupPlane(gl) {
    // Vertices for a full-screen quad (two triangles)
    const positions = new Float32Array([
        -1, -1, // Bottom-left
         1, -1, // Bottom-right
        -1,  1, // Top-left
        -1,  1, // Top-left
         1, -1, // Bottom-right
         1,  1, // Top-right
    ]);

    // Texture coordinates (conventional mapping: 0,0 = bottom-left)
    const texCoords = new Float32Array([
        0, 0, // Bottom-left
        1, 0, // Bottom-right
        0, 1, // Top-left
        0, 1, // Top-left
        1, 0, // Bottom-right
        1, 1, // Top-right
    ]);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    // Setup attributes for programDifference
    gl.useProgram(programDifference);
    const posLocDiff = gl.getAttribLocation(programDifference, 'a_position');
    if (posLocDiff >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(posLocDiff);
        gl.vertexAttribPointer(posLocDiff, 2, gl.FLOAT, false, 0, 0);
    }
    const texLocDiff = gl.getAttribLocation(programDifference, 'a_texCoord');
    if (texLocDiff >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texLocDiff);
        gl.vertexAttribPointer(texLocDiff, 2, gl.FLOAT, false, 0, 0);
    }

    // Setup attributes for programCopy
    gl.useProgram(programCopy);
    const posLocCopy = gl.getAttribLocation(programCopy, 'a_position');
    if (posLocCopy >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(posLocCopy);
        gl.vertexAttribPointer(posLocCopy, 2, gl.FLOAT, false, 0, 0);
    }
    const texLocCopy = gl.getAttribLocation(programCopy, 'a_texCoord');
    if (texLocCopy >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texLocCopy);
        gl.vertexAttribPointer(texLocCopy, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null); // Unbind VAO
}

function createTexture(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); // Null data for initial allocation
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

// Add: ensure #version is at the very start (strip leading whitespace / BOM)
function preprocessShaderSource(src) {
    if (!src) return '';
    // Remove BOM and any leading whitespace/newlines so "#version" is the first token
    return src.replace(/^[\uFEFF\s]+/, '');
}

function initWebGL() {
    const canvas = document.getElementById('webglCanvas');
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true }); // WebGL2 preferred
    // Initialize grayscale canvas
    const grayscaleCanvas = document.getElementById('grayscaleCanvas');
    grayscaleGl = grayscaleCanvas.getContext('webgl2', { preserveDrawingBuffer: true });
    // Initialize detection canvas
    const detectionCanvas = document.getElementById('detectionCanvas');
    detectionGl = detectionCanvas.getContext('webgl2', { preserveDrawingBuffer: true });
    
    if (!gl || !grayscaleGl || !detectionGl) {
        gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }); // Fallback to WebGL1
        if (!gl) {
            alert('Your browser does not support WebGL!');
            return;
        }
        console.warn('Using WebGL1. Some features (like #version 300 es shaders) might need adjustments.');
    }

    // Compile shaders
    const vsSource = preprocessShaderSource(document.getElementById('vertex-shader').textContent);
    const diffFsSource = preprocessShaderSource(document.getElementById('difference-fragment-shader').textContent);
    const copyFsSource = preprocessShaderSource(document.getElementById('copy-fragment-shader').textContent);
    const grayscaleFsSource = preprocessShaderSource(document.getElementById('grayscale-fragment-shader').textContent);
    const logFsSource = preprocessShaderSource(document.getElementById('laplacian-gaussian-fragment-shader').textContent);

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const differenceFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, diffFsSource);
    const copyFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, copyFsSource);
    
    // Create grayscale shader for grayscale canvas
    const grayscaleVertexShader = createShader(grayscaleGl, grayscaleGl.VERTEX_SHADER, vsSource);
    const grayscaleFragmentShader = createShader(grayscaleGl, grayscaleGl.FRAGMENT_SHADER, grayscaleFsSource);

    // Create LoG shader for detection canvas
    const detectionVertexShader = createShader(detectionGl, detectionGl.VERTEX_SHADER, vsSource);
    const logFragmentShader = createShader(detectionGl, detectionGl.FRAGMENT_SHADER, logFsSource);

    programDifference = createProgram(gl, vertexShader, differenceFragmentShader);
    programCopy = createProgram(gl, vertexShader, copyFragmentShader);
    programGrayscale = createProgram(grayscaleGl, grayscaleVertexShader, grayscaleFragmentShader);
    programLaplacianGaussian = createProgram(detectionGl, detectionVertexShader, logFragmentShader);

    if (!programDifference || !programCopy || !programGrayscale || !programLaplacianGaussian) return;

    setupPlane(gl);
    setupGrayscalePlane(grayscaleGl);
    setupDetectionPlane(detectionGl);

    // Get uniform locations
    programDifference.uniforms = {
        imageA: gl.getUniformLocation(programDifference, 'u_imageA'),
        imageB: gl.getUniformLocation(programDifference, 'u_imageB')
    };
    programCopy.uniforms = {
        image: gl.getUniformLocation(programCopy, 'u_image')
    };

    // Setup grayscale program uniforms
    grayscaleGl.useProgram(programGrayscale);
    programGrayscale.uniforms = {
        image: grayscaleGl.getUniformLocation(programGrayscale, 'u_image')
    };
    grayscaleGl.uniform1i(programGrayscale.uniforms.image, 0);

    // Setup detection program uniforms
    detectionGl.useProgram(programLaplacianGaussian);
    programLaplacianGaussian.uniforms = {
        image: detectionGl.getUniformLocation(programLaplacianGaussian, 'u_image'),
        resolution: detectionGl.getUniformLocation(programLaplacianGaussian, 'u_resolution')
    };
    detectionGl.uniform1i(programLaplacianGaussian.uniforms.image, 0);

    // Set texture units for difference shader
    gl.useProgram(programDifference);
    gl.uniform1i(programDifference.uniforms.imageA, 0); // Texture unit 0
    gl.uniform1i(programDifference.uniforms.imageB, 1); // Texture unit 1

    gl.useProgram(programCopy);
    gl.uniform1i(programCopy.uniforms.image, 0); // Texture unit 0 for copy

    // Initial textures (will be updated with video dimensions)
    currentTexture = createTexture(gl, 1, 1); // Placeholder
    previousTexture = createTexture(gl, 1, 1); // Placeholder
    grayscaleTexture = createTexture(grayscaleGl, 1, 1); // Placeholder
    detectionTexture = createTexture(detectionGl, 1, 1); // Placeholder

    // Create a framebuffer for offscreen rendering (to copy current to previous)
    framebuffer = gl.createFramebuffer();
}

function setupGrayscalePlane(gl) {
    const positions = new Float32Array([
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
    ]);
    const texCoords = new Float32Array([
        0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1
    ]);

    grayscaleVao = gl.createVertexArray();
    gl.bindVertexArray(grayscaleVao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    gl.useProgram(programGrayscale);
    const posLoc = gl.getAttribLocation(programGrayscale, 'a_position');
    if (posLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }
    const texLoc = gl.getAttribLocation(programGrayscale, 'a_texCoord');
    if (texLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
}

function setupDetectionPlane(gl) {
    const positions = new Float32Array([
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
    ]);
    const texCoords = new Float32Array([
        0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1
    ]);

    detectionVao = gl.createVertexArray();
    gl.bindVertexArray(detectionVao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    gl.useProgram(programLaplacianGaussian);
    const posLoc = gl.getAttribLocation(programLaplacianGaussian, 'a_position');
    if (posLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }
    const texLoc = gl.getAttribLocation(programLaplacianGaussian, 'a_texCoord');
    if (texLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
}

function render() {
    // Fixed readyState check
    if (!videoElement || videoElement.readyState < videoElement.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(render);
        return;
    }

    // Adjust canvas sizes
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    if (gl.canvas.width !== videoWidth || gl.canvas.height !== videoHeight) {
        gl.canvas.width = videoWidth;
        gl.canvas.height = videoHeight;
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        
        // Also resize grayscale canvas
        grayscaleGl.canvas.width = videoWidth;
        grayscaleGl.canvas.height = videoHeight;
        grayscaleGl.viewport(0, 0, grayscaleGl.canvas.width, grayscaleGl.canvas.height);

        // Also resize detection canvas
        detectionGl.canvas.width = videoWidth;
        detectionGl.canvas.height = videoHeight;
        detectionGl.viewport(0, 0, detectionGl.canvas.width, detectionGl.canvas.height);

        // Re-create textures with correct dimensions
        currentTexture = createTexture(gl, videoWidth, videoHeight);
        previousTexture = createTexture(gl, videoWidth, videoHeight);
        grayscaleTexture = createTexture(grayscaleGl, videoWidth, videoHeight);
        detectionTexture = createTexture(detectionGl, videoWidth, videoHeight);
    }

    // --- Step 1: Upload current video frame to currentTexture ---
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);

    // Ensure the uploaded video pixels map upright and alpha doesn't premultiply color
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);

    // --- Step 1.5: Render grayscale to grayscale canvas ---
    grayscaleGl.activeTexture(grayscaleGl.TEXTURE0);
    grayscaleGl.bindTexture(grayscaleGl.TEXTURE_2D, grayscaleTexture);
    grayscaleGl.pixelStorei(grayscaleGl.UNPACK_FLIP_Y_WEBGL, true);
    grayscaleGl.pixelStorei(grayscaleGl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    grayscaleGl.texImage2D(grayscaleGl.TEXTURE_2D, 0, grayscaleGl.RGBA, grayscaleGl.RGBA, grayscaleGl.UNSIGNED_BYTE, videoElement);

    grayscaleGl.bindFramebuffer(grayscaleGl.FRAMEBUFFER, null);
    grayscaleGl.useProgram(programGrayscale);
    grayscaleGl.activeTexture(grayscaleGl.TEXTURE0);
    grayscaleGl.bindTexture(grayscaleGl.TEXTURE_2D, grayscaleTexture);
    grayscaleGl.bindVertexArray(grayscaleVao);
    grayscaleGl.drawArrays(grayscaleGl.TRIANGLES, 0, 6);
    grayscaleGl.bindVertexArray(null);

    // --- Step 1.6: Apply LoG filter to either grayscale or difference and render to detection canvas ---
    let inputPixels;
    
    if (useGrayscaleForDetection) {
        // Use grayscale output as input for LoG filter
        inputPixels = new Uint8Array(videoWidth * videoHeight * 4);
        grayscaleGl.readPixels(0, 0, videoWidth, videoHeight, grayscaleGl.RGBA, grayscaleGl.UNSIGNED_BYTE, inputPixels);
    } else {
        // Use difference output as input for LoG filter
        // First render the difference to get the pixels
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(programDifference);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        
        // Read the difference pixels
        inputPixels = new Uint8Array(videoWidth * videoHeight * 4);
        gl.readPixels(0, 0, videoWidth, videoHeight, gl.RGBA, gl.UNSIGNED_BYTE, inputPixels);
    }
    
    // Upload the selected input to detection texture
    detectionGl.activeTexture(detectionGl.TEXTURE0);
    detectionGl.bindTexture(detectionGl.TEXTURE_2D, detectionTexture);
    detectionGl.pixelStorei(detectionGl.UNPACK_FLIP_Y_WEBGL, false);
    detectionGl.texImage2D(detectionGl.TEXTURE_2D, 0, detectionGl.RGBA, videoWidth, videoHeight, 0, detectionGl.RGBA, detectionGl.UNSIGNED_BYTE, inputPixels);

    // Apply LoG filter
    detectionGl.bindFramebuffer(detectionGl.FRAMEBUFFER, null);
    detectionGl.useProgram(programLaplacianGaussian);
    detectionGl.uniform2f(programLaplacianGaussian.uniforms.resolution, videoWidth, videoHeight);
    detectionGl.activeTexture(detectionGl.TEXTURE0);
    detectionGl.bindTexture(detectionGl.TEXTURE_2D, detectionTexture);
    detectionGl.bindVertexArray(detectionVao);
    detectionGl.drawArrays(detectionGl.TRIANGLES, 0, 6);
    detectionGl.bindVertexArray(null);

    // --- Step 2: Render the difference (if using grayscale for detection) ---
    if (useGrayscaleForDetection) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(programDifference);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
    }

    // --- Step 3: Handle the 1-second delay for the 'previous' frame ---
    const currentTime = performance.now();
    if (currentTime - lastFrameTime >= DELAY_MS) {
        // Copy currentTexture to previousTexture using the copy shader
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, previousTexture, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
            gl.viewport(0, 0, videoWidth, videoHeight); // Ensure viewport matches texture size for copy
            gl.useProgram(programCopy);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, currentTexture); // Source for copy
            gl.bindVertexArray(vao);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindVertexArray(null);
        } else {
            console.error('Framebuffer not complete:', gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        }

        lastFrameTime = currentTime;
    }

    requestAnimationFrame(render);
}

// --- Main execution ---
// Removed automatic start on page load. Camera will be started only via the "Start Camera" button.

// Webcam start logic with error handling
(() => {
	const startBtn = document.getElementById('startBtn');
	const statusEl = document.getElementById('status');
	const video = document.getElementById('webcamVideo');

	function log(msg) {
		console.log(msg);
		if (statusEl) statusEl.textContent = String(msg);
	}

	// Try navigator.mediaDevices.getUserMedia with graceful fallbacks
	async function tryGetUserMedia(constraints) {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			// legacy prefixes will be attempted by fallbackGetUserMedia
			throw new Error('navigator.mediaDevices.getUserMedia not available');
		}
		return navigator.mediaDevices.getUserMedia(constraints);
	}

	// Legacy fallback wrapper (webkit/moz)
	function fallbackGetUserMedia(constraints) {
		return new Promise((resolve, reject) => {
			const g = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
			if (!g) {
				reject(new Error('No getUserMedia available'));
				return;
			}
			g.call(navigator, constraints, resolve, reject);
		});
	}

	async function startWebcam() {
		log('Starting webcam...');
		if (isStarted) {
			log('Already started.');
			return;
		}
		if (!window.isSecureContext) {
			log('Must run on HTTPS or localhost for getUserMedia to work.');
			return;
		}

		// For diagnostics: list available video input devices (labels may be empty until permission granted)
		try {
			if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
				const devices = await navigator.mediaDevices.enumerateDevices();
				const cams = devices.filter(d => d.kind === 'videoinput').map(d => `${d.deviceId} ${d.label || ''}`);
				console.debug('Video inputs:', cams);
			}
		} catch (e) {
			console.debug('Could not enumerate devices:', e);
		}

		// Preferred constraints
		let constraints = {
			video: {
				facingMode: 'user',
				width: { ideal: 1280 },
				height: { ideal: 720 }
			},
			audio: false
		};

		let stream = null;
		try {
			stream = await tryGetUserMedia(constraints);
		} catch (err) {
			console.warn('Initial getUserMedia failed:', err);
			// Try to handle common cases
			if (err && err.name === 'OverconstrainedError') {
				log('Requested resolution not supported — retrying with default resolution...');
				constraints = { video: true, audio: false };
				try {
					stream = await tryGetUserMedia(constraints);
				} catch (err2) {
					console.warn('Retry with default constraints failed:', err2);
				}
			} else if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
				log('Permission denied — please allow camera access in the browser.');
			} else if (err && err.name === 'NotFoundError') {
				log('No camera found on this device.');
			}

			// Try legacy fallback if still no stream
			if (!stream) {
				try {
					stream = await fallbackGetUserMedia(constraints);
				} catch (legacyErr) {
					console.warn('Legacy getUserMedia failed:', legacyErr);
				}
			}
		}

		if (!stream) {
			log('Could not access camera. See console for details.');
			return;
		}

		// Attach stream to video element and start playback
		video.srcObject = stream;
		// Set global videoElement so render/initWebGL can use it
		videoElement = video;

		video.onloadedmetadata = async () => {
			try {
				await video.play();
			} catch (e) {
				console.warn('video.play error:', e);
			}
			log('Camera started.');

			// Initialize WebGL and start render loop once
			if (!gl) initWebGL();
			if (!isStarted) {
				isStarted = true;
				requestAnimationFrame(render);
			}
		};
	}

	// Wire UI
	if (startBtn) startBtn.addEventListener('click', startWebcam);

	// Add toggle button functionality
	const toggleBtn = document.getElementById('toggleFilterBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            useGrayscaleForDetection = !useGrayscaleForDetection;
            toggleBtn.textContent = useGrayscaleForDetection ? 
                'Switch to Difference Input' : 
                'Switch to Grayscale Input';
            console.log('Filter input switched to:', useGrayscaleForDetection ? 'Grayscale' : 'Difference');
        });
        
        // Set initial button text
        toggleBtn.textContent = 'Switch to Difference Input';
    }

    const delayInput = document.getElementById('delayInput');
    if (delayInput) {
        delayInput.addEventListener('input', () => {
            const delay = parseInt(delayInput.value, 10);
            if (!isNaN(delay)) {
                DELAY_MS = delay;
                console.log('Processing delay set to:', DELAY_MS, 'ms');
            }
        });
    }

    // Optional: auto-start on page load (disabled)
    // window.addEventListener('load', () => { /* startWebcam(); */ });
})();