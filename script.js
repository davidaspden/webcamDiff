// --- Global Variables ---
let videoElement;
let gl;
let programDifference;
let programCopy;
let currentTexture;
let previousTexture;
let framebuffer; // For offscreen rendering
let vao;
let lastFrameTime = 0;
const DELAY_MS = 1000; // 1 second delay
let isStarted = false; // Added: prevent multiple starts

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
    if (!gl) {
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

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const differenceFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, diffFsSource);
    const copyFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, copyFsSource);

    programDifference = createProgram(gl, vertexShader, differenceFragmentShader);
    programCopy = createProgram(gl, vertexShader, copyFragmentShader);

    if (!programDifference || !programCopy) return;

    setupPlane(gl);

    // Get uniform locations
    programDifference.uniforms = {
        imageA: gl.getUniformLocation(programDifference, 'u_imageA'),
        imageB: gl.getUniformLocation(programDifference, 'u_imageB')
    };
    programCopy.uniforms = {
        image: gl.getUniformLocation(programCopy, 'u_image')
    };

    // Set texture units for difference shader
    gl.useProgram(programDifference);
    gl.uniform1i(programDifference.uniforms.imageA, 0); // Texture unit 0
    gl.uniform1i(programDifference.uniforms.imageB, 1); // Texture unit 1

    gl.useProgram(programCopy);
    gl.uniform1i(programCopy.uniforms.image, 0); // Texture unit 0 for copy

    // Initial textures (will be updated with video dimensions)
    currentTexture = createTexture(gl, 1, 1); // Placeholder
    previousTexture = createTexture(gl, 1, 1); // Placeholder

    // Create a framebuffer for offscreen rendering (to copy current to previous)
    framebuffer = gl.createFramebuffer();
}

function render() {
    // Fixed readyState check
    if (!videoElement || videoElement.readyState < videoElement.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(render);
        return;
    }

    // Adjust canvas size to match video aspect ratio
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    if (gl.canvas.width !== videoWidth || gl.canvas.height !== videoHeight) {
        gl.canvas.width = videoWidth;
        gl.canvas.height = videoHeight;
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        // Re-create textures with correct dimensions
        currentTexture = createTexture(gl, videoWidth, videoHeight);
        previousTexture = createTexture(gl, videoWidth, videoHeight);
    }

    // --- Step 1: Upload current video frame to currentTexture ---
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);

    // Ensure the uploaded video pixels map upright and alpha doesn't premultiply color
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);

    // --- Step 2: Render the difference ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Render to canvas
    gl.useProgram(programDifference);
    gl.activeTexture(gl.TEXTURE0); // Current frame
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
    gl.activeTexture(gl.TEXTURE1); // Previous frame
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

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

	// Optional: auto-start on page load (disabled)
	// window.addEventListener('load', () => { /* startWebcam(); */ });
})();