/**
 * Vendored + extended copy of three's AsciiEffect
 * (three/examples/jsm/effects/AsciiEffect.js, MIT). Original ascii generation is based on
 * https://github.com/hassadee/jsascii/blob/master/jsascii.js — 16 April 2012 @blurspline.
 *
 * Added: a `phrase` option. When set, instead of mapping brightness to a character ramp,
 * the eye's lit silhouette is filled with the phrase repeated and flowing continuously
 * across the shape (background cells stay blank). Empty phrase => stock ramp behaviour.
 */

class PhraseAsciiEffect {

	constructor( renderer, charSet = ' .:-=+*#%@', options = {} ) {

		// Some ASCII settings

		const fResolution = options[ 'resolution' ] || 0.15; // Higher for more details
		const iScale = options[ 'scale' ] || 1;
		const bColor = options[ 'color' ] || false; // nice but slows down rendering!
		const bAlpha = options[ 'alpha' ] || false; // Transparency
		const bBlock = options[ 'block' ] || false; // blocked characters. like good O dos
		const bInvert = options[ 'invert' ] || false; // black is white, white is black
		const strResolution = options[ 'strResolution' ] || 'low';
		// When non-empty, lit cells spell out this phrase (flowing through the silhouette)
		// instead of using the brightness ramp. Background cells stay blank.
		const strPhrase = options[ 'phrase' ] || '';

		let width, height;

		const domElement = document.createElement( 'div' );
		domElement.style.cursor = 'default';

		const oAscii = document.createElement( 'table' );
		domElement.appendChild( oAscii );

		let iWidth, iHeight;
		let oImg;

		this.setSize = function ( w, h ) {

			width = w;
			height = h;

			renderer.setSize( w, h );

			initAsciiSize();

		};


		this.render = function ( scene, camera ) {

			renderer.render( scene, camera );
			asciifyImage( oAscii );

		};

		this.domElement = domElement;


		function initAsciiSize() {

			iWidth = Math.floor( width * fResolution );
			iHeight = Math.floor( height * fResolution );

			oCanvas.width = iWidth;
			oCanvas.height = iHeight;

			// A resize changes the cell's inline width/height, so the next frame must
			// write even if the glyphs come out identical.
			strLastFrame = null;
			// Re-arm the one-shot size compensation, and clear any stale scale so the
			// fresh grid is never measured through the previous compensation.
			bNeedsMeasure = true;
			oAscii.style.transform = '';

			oImg = renderer.domElement;

			if ( oImg.style.backgroundColor ) {

				oAscii.rows[ 0 ].cells[ 0 ].style.backgroundColor = oImg.style.backgroundColor;
				oAscii.rows[ 0 ].cells[ 0 ].style.color = oImg.style.color;

			}

			oAscii.cellSpacing = 0;
			oAscii.cellPadding = 0;

			const oStyle = oAscii.style;
			oStyle.whiteSpace = 'pre';
			oStyle.margin = '0px';
			oStyle.padding = '0px';
			oStyle.letterSpacing = fLetterSpacing + 'px';
			oStyle.fontFamily = strFont;
			oStyle.fontSize = fFontSize + 'px';
			oStyle.lineHeight = fLineHeight + 'px';
			// Center (not left) so any residual gap between the art width and the image width
			// stays symmetric — the face is centered in the grid, so it reads as centered
			// regardless of small font-metric differences across resolutions.
			oStyle.textAlign = 'center';
			oStyle.textDecoration = 'none';
			// iOS Safari text autosizing inflates tiny text (the glyphs run as small as
			// ~4px on phones), which blows the art out of its fixed-px cell. Disable it
			// here (not just in the host CSS) so the vendored effect stays portable.
			oStyle.webkitTextSizeAdjust = '100%';
			oStyle.textSizeAdjust = '100%';

		}


		const aDefaultCharList = ( ' .,:;i1tfLCG08@' ).split( '' );
		const aDefaultColorCharList = ( ' CGO08@' ).split( '' );
		const strFont = 'courier new, monospace';

		const oCanvasImg = renderer.domElement;

		const oCanvas = document.createElement( 'canvas' );
		if ( ! oCanvas.getContext ) {

			return;

		}

		// willReadFrequently keeps the canvas CPU-side: getImageData runs every frame,
		// and a GPU-backed canvas would stall on the readback sync each time.
		const oCtx = oCanvas.getContext( '2d', { willReadFrequently: true } );
		if ( ! oCtx.getImageData ) {

			return;

		}

		let aCharList = ( bColor ? aDefaultColorCharList : aDefaultCharList );

		if ( charSet ) aCharList = charSet;

		// Setup dom

		const fFontSize = ( 2 / fResolution ) * iScale;
		const fLineHeight = ( 2 / fResolution ) * iScale;

		// adjust letter-spacing for all combinations of scale and resolution to get it to fit the image width.

		let fLetterSpacing = 0;

		if ( strResolution == 'low' ) {

			switch ( iScale ) {

				// Scale letter-spacing with the font (which is 2/fResolution) so the row fills
				// the image width at ANY resolution. The original constant -1 only filled at one
				// resolution (~0.2); at a higher resolution the font shrinks but a fixed -1 packs
				// glyphs too tight, leaving the art narrower than the container — a horizontal
				// squish that also reads as off-center under left-align. -0.2/fResolution == -1
				// at that original calibration point and stays correct elsewhere.
				case 1 : fLetterSpacing = - 0.2 / fResolution; break;
				case 2 :
				case 3 : fLetterSpacing = - 2.1; break;
				case 4 : fLetterSpacing = - 3.1; break;
				case 5 : fLetterSpacing = - 4.15; break;

			}

		}

		if ( strResolution == 'medium' ) {

			switch ( iScale ) {

				case 1 : fLetterSpacing = 0; break;
				case 2 : fLetterSpacing = - 1; break;
				case 3 : fLetterSpacing = - 1.04; break;
				case 4 :
				case 5 : fLetterSpacing = - 2.1; break;

			}

		}

		if ( strResolution == 'high' ) {

			switch ( iScale ) {

				case 1 :
				case 2 : fLetterSpacing = 0; break;
				case 3 :
				case 4 :
				case 5 : fLetterSpacing = - 1; break;

			}

		}


		// convert img element to ascii

		// Last frame's generated markup: with the subtle ambient wave most frames
		// quantize to the exact same glyph grid, so a string compare (cheap) skips the
		// innerHTML rewrite + reflow (expensive) whenever nothing visible changed.
		let strLastFrame = null;

		// Re-measure trigger: after every build/resize, measure the art the browser
		// actually laid out and transform the table to fit its cell. Cleared only once
		// a real measurement lands (0-rects while hidden/detached retry on a later
		// frame), then refreshed periodically so metrics that settle late (font load,
		// iOS layout passes) can't leave a stale correction.
		let bNeedsMeasure = false;
		let iLastMeasure = 0;
		const MEASURE_INTERVAL_MS = 1000;

		// The glyph grid's physical size assumes the browser honors the fractional
		// letter-spacing and tiny font-size computed above. iOS Safari rounds
		// letter-spacing to whole px (at mobile resolutions the spacing is ~-0.4px, a
		// ~0.6px/char error across a 150+ char row), so the art can render wider or
		// taller than its fixed-px cell — cropped by overflow:hidden and misaligned
		// with the canvas layers behind it. Measure the real art bounds via a Range
		// (reports true, unclipped, fractional geometry) and map them onto the cell's
		// own measured rect with a translate+scale on the table. Both rects live in
		// the same transform space, so ancestor transforms cancel. The translate
		// matters as much as the scale: the art flows from the cell's TOP, so when
		// its height is off, its center is off too — a bare center-origin scale fixes
		// the size but keeps that offset (this was visibly wrong on iOS).
		// Desktop computes ~identity and is left untouched. Returns false when
		// nothing measurable exists yet.
		function compensateScale( oAscii ) {

			const oCell = oAscii.rows[ 0 ] && oAscii.rows[ 0 ].cells[ 0 ];
			if ( ! oCell ) return false;

			oAscii.style.transform = ''; // measure unscaled (repainted only after this task)
			const oRange = document.createRange();
			oRange.selectNodeContents( oCell );
			const art = oRange.getBoundingClientRect();
			const box = oCell.getBoundingClientRect();
			const tab = oAscii.getBoundingClientRect();
			if ( art.width <= 0 || art.height <= 0 || box.width <= 0 || box.height <= 0 ) return false;

			const sx = box.width / art.width;
			const sy = box.height / art.height;
			// Solve translate so the scaled art's top-left lands exactly on the box's
			// top-left (transform maps p -> tab.origin + t + s*(p - tab.origin)).
			const tx = box.left - tab.left - sx * ( art.left - tab.left );
			const ty = box.top - tab.top - sy * ( art.top - tab.top );
			// Metrics are honest (desktop path) => leave the transform empty.
			if ( Math.abs( sx - 1 ) < 0.005 && Math.abs( sy - 1 ) < 0.005
				&& Math.abs( tx ) < 0.5 && Math.abs( ty ) < 0.5 ) return true;

			// Transform the TABLE, not the wrapper div: the host's CRT power-on
			// animation owns the wrapper's transform.
			oAscii.style.transformOrigin = '0 0';
			oAscii.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
			return true;

		}

		function asciifyImage( oAscii ) {

			oCtx.clearRect( 0, 0, iWidth, iHeight );
			oCtx.drawImage( oCanvasImg, 0, 0, iWidth, iHeight );
			const oImgData = oCtx.getImageData( 0, 0, iWidth, iHeight ).data;

			// Coloring loop starts now
			let strChars = '';

			// Running cursor into the phrase: advances only on ink (non-background) cells so
			// the phrase flows continuously across the lit silhouette regardless of its shape.
			let iPhraseIdx = 0;

			for ( let y = 0; y < iHeight; y += 2 ) {

				for ( let x = 0; x < iWidth; x ++ ) {

					const iOffset = ( y * iWidth + x ) * 4;

					const iRed = oImgData[ iOffset ];
					const iGreen = oImgData[ iOffset + 1 ];
					const iBlue = oImgData[ iOffset + 2 ];
					const iAlpha = oImgData[ iOffset + 3 ];
					let iCharIdx;

					let fBrightness;

					fBrightness = ( 0.3 * iRed + 0.59 * iGreen + 0.11 * iBlue ) / 255;

					if ( iAlpha == 0 ) {

						// should calculate alpha instead, but quick hack :)
						fBrightness = 1;

					}

					iCharIdx = Math.floor( ( 1 - fBrightness ) * ( aCharList.length - 1 ) );

					if ( bInvert ) {

						iCharIdx = aCharList.length - iCharIdx - 1;

					}

					let strThisChar = aCharList[ iCharIdx ];

					if ( strThisChar === undefined || strThisChar == ' ' )
						strThisChar = '&nbsp;';

					// Phrase mode: keep the ramp's blank cells blank (they mark the background),
					// but fill every "ink" cell with the next phrase character instead of the
					// brightness glyph.
					if ( strPhrase ) {

						if ( strThisChar === '&nbsp;' ) {

							// background cell — leave blank, don't advance the phrase cursor.

						} else {

							const strPhraseChar = strPhrase[ iPhraseIdx % strPhrase.length ];
							iPhraseIdx ++;
							strThisChar = ( strPhraseChar === ' ' || strPhraseChar === undefined )
								? '&nbsp;'
								: strPhraseChar;

						}

					}

					if ( bColor ) {

						strChars += '<span style=\''
							+ 'color:rgb(' + iRed + ',' + iGreen + ',' + iBlue + ');'
							+ ( bBlock ? 'background-color:rgb(' + iRed + ',' + iGreen + ',' + iBlue + ');' : '' )
							+ ( bAlpha ? 'opacity:' + ( iAlpha / 255 ) + ';' : '' )
							+ '\'>' + strThisChar + '</span>';

					} else {

						strChars += strThisChar;

					}

				}

				strChars += '<br/>';

			}

			if ( strChars !== strLastFrame ) {

				strLastFrame = strChars;
				oAscii.innerHTML = `<tr><td style="display:block;width:${width}px;height:${height}px;overflow:hidden">${strChars}</td></tr>`;

			}

			// Runs even on content-identical frames so a pending measurement isn't
			// starved by the strLastFrame skip. Re-measures on a slow heartbeat too:
			// deterministic layouts re-produce the identical transform (no jitter),
			// but late-settling metrics get corrected within a second.
			const iNow = Date.now();
			if ( bNeedsMeasure || iNow - iLastMeasure > MEASURE_INTERVAL_MS ) {

				if ( compensateScale( oAscii ) ) {

					bNeedsMeasure = false;
					iLastMeasure = iNow;

				}

			}

		}

	}

}

export { PhraseAsciiEffect };
