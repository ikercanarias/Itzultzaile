(function () {
    var video = document.querySelector('video');

    var pictureWidth = 640;
    var pictureHeight = 360;

    var fxCanvas = null;
    var texture = null;

    var user_key_job = "";
    
    function checkRequirements() {
        var deferred = new $.Deferred();

        //Check if getUserMedia is available
        if (!Modernizr.getusermedia) {
            deferred.reject('Your browser doesn\'t support getUserMedia (according to Modernizr).');
        }

        //Check if WebGL is available
        if (Modernizr.webgl) {
            try {
                //setup glfx.js
                fxCanvas = fx.canvas();
            } catch (e) {
                deferred.reject('Sorry, glfx.js failed to initialize. WebGL issues?');
            }
        } else {
            deferred.reject('Your browser doesn\'t support WebGL (according to Modernizr).');
        }

        deferred.resolve();

        return deferred.promise();
    }

    function searchForRearCamera() {
        var deferred = new $.Deferred();

        //MediaStreamTrack.getSources seams to be supported only by Chrome
        if (MediaStreamTrack && MediaStreamTrack.getSources) {
            MediaStreamTrack.getSources(function (sources) {
                var rearCameraIds = sources.filter(function (source) {
                    return (source.kind === 'video' && source.facing === 'environment');
                }).map(function (source) {
                    return source.id;
                });

                if (rearCameraIds.length) {
                    deferred.resolve(rearCameraIds[0]);
                } else {
                    deferred.resolve(null);
                }
            });
        } else {
            deferred.resolve(null);
        }

        return deferred.promise();
    }

    function setupVideo(rearCameraId) {
        var deferred = new $.Deferred();
        var videoSettings = {
            video: {
		 "facingMode": 
            			{ "ideal": "environment" }
            	},
                optional: [
                    {
                        width: { min: pictureWidth }
                    },
                    {
                        height: { min: pictureHeight }
                    }
                ]
            }
        };

        //if rear camera is available - use it
        if (rearCameraId) {
            videoSettings.video.optional.push({
                sourceId: rearCameraId
            });
        }

        navigator.mediaDevices.getUserMedia(videoSettings)
            .then(function (stream) {
                //Setup the video stream
                video.srcObject = stream;

                video.addEventListener("loadedmetadata", function (e) {
                    //get video width and height as it might be different than we requested
                    pictureWidth = this.videoWidth;
                    pictureHeight = this.videoHeight;

                    if (!pictureWidth && !pictureHeight) {
                        //firefox fails to deliver info about video size on time (issue #926753), we have to wait
                        var waitingForSize = setInterval(function () {
                            if (video.videoWidth && video.videoHeight) {
                                pictureWidth = video.videoWidth;
                                pictureHeight = video.videoHeight;

                                clearInterval(waitingForSize);
                                deferred.resolve();
                            }
                        }, 100);
                    } else {
                        deferred.resolve();
                    }
                }, false);
            }).catch(function () {
                deferred.reject('There is no access to your camera, have you denied it?');
            });

        return deferred.promise();
    }

    function step1() {
        checkRequirements()
            .then(searchForRearCamera)
            .then(setupVideo)
            .done(function () {
                //Enable the 'take picture' button
                $('#takePicture').removeAttr('disabled');
                //Hide the 'enable the camera' info
                $('#step1 figure').removeClass('not-ready');
            })
            .fail(function (error) {
                showError(error);
            });
    }

    function step2() {
        var canvas = document.querySelector('#step2 canvas');
        var img = document.querySelector('#step2 img');

        //setup canvas
        canvas.width = pictureWidth;
        canvas.height = pictureHeight;

        var ctx = canvas.getContext('2d');

        //draw picture from video on canvas
        ctx.drawImage(video, 0, 0);

        //modify the picture using glfx.js filters
        texture = fxCanvas.texture(canvas);
        fxCanvas.draw(texture)
            .hueSaturation(-1, -1)//grayscale
            .unsharpMask(20, 2)
            .brightnessContrast(0.2, 0.9)
            .update();

        window.texture = texture;
        window.fxCanvas = fxCanvas;

        $(img)
            //setup the crop utility
            .one('load', function () {
                if (!$(img).data().Jcrop) {
                    $(img).Jcrop({
                        onSelect: function () {
                            //Enable the 'done' button
                            $('#adjust').removeAttr('disabled');
                        }
                    });
                } else {
                    //update crop tool (it creates copies of <img> that we have to update manually)
                    $('.jcrop-holder img').attr('src', fxCanvas.toDataURL());
                }
            })
            //show output from glfx.js
            .attr('src', fxCanvas.toDataURL());
    }

    function step3() {
        var canvas = document.querySelector('#step3 canvas');
        var step2Image = document.querySelector('#step2 img');
        var cropData = $(step2Image).data().Jcrop.tellSelect();

        var scale = step2Image.width / $(step2Image).width();

        //draw cropped image on the canvas
        canvas.width = cropData.w * scale;
        canvas.height = cropData.h * scale;

        var ctx = canvas.getContext('2d');
        ctx.drawImage(
            step2Image,
            cropData.x * scale,
            cropData.y * scale,
            cropData.w * scale,
            cropData.h * scale,
            0,
            0,
            cropData.w * scale,
            cropData.h * scale);

        var spinner = $('.spinner');
        spinner.show();
        $('blockquote p').text('');
        $('blockquote footer').text('');

        // do the OCR!
        Tesseract.recognize(ctx).then(function (result) {
            var resultText = result.text ? result.text.trim() : '';

            //show the result
            spinner.hide();
            $('blockquote p').html('&bdquo;' + resultText + '&ldquo;');
            $('blockquote footer').text('(' + resultText.length + ' characters)');
        });
    }

    /*********************************
     * UI Stuff
     *********************************/

    //start step1 immediately
    step1();
    $('.help').popover();

    function changeStep(step) {
        if (step === 1) {
            video.play();
        } else {
            video.pause();
        }

        $('body').attr('class', 'step' + step);
        $('.nav li.active').removeClass('active');
        $('.nav li:eq(' + (step - 1) + ')').removeClass('disabled').addClass('active');
    }

    function showError(text) {
        $('.alert').show().find('span').text(text);
    }

    //handle brightness/contrast change
    $('#brightness, #contrast').on('change', function () {
        var brightness = $('#brightness').val() / 100;
        var contrast = $('#contrast').val() / 100;
        var img = document.querySelector('#step2 img');

        fxCanvas.draw(texture)
            .hueSaturation(-1, -1)
            .unsharpMask(20, 2)
            .brightnessContrast(brightness, contrast)
            .update();

        img.src = fxCanvas.toDataURL();

        //update crop tool (it creates copies of <img> that we have to update manually)
        $('.jcrop-holder img').attr('src', fxCanvas.toDataURL());
    });

    $('#takePicture').click(function () {
        step2();
        changeStep(2);
    });

    function get_translation_status() {

    	var model = "eu2es";
    	//var model = "es2eu";
    	var model_send = "";
    	var host = "";
    	var masterkey = ""; 
    	if(model == "es2eu"){
            model_send = "generic_es2eu"
            host = "eseu.itzuli.euskadi.eus"
            masterkey = "5dbb8428-51b4-4c47-bfdc-a7762595fe74"
    	} else {
    		model_send = "generic_eu2es"
            host = "eues.itzuli.euskadi.eus"
            masterkey = "5dbb8428-51b4-4c47-bfdc-a7762595fe74"
    	}
  
	    
        $.ajaxSetup({ cache: false });
        // Get job status using the assigned user key for this job
        $.ajax({
            url: "https://cors-anywhere.herokuapp.com/https://"+host+"/job/" + user_key_job + "/status",
            type: 'GET',
            dataType: 'json',
            crossDomain: true,
            /*xhrFields: {
                    withCredentials: true
            },*/
            success: function(data) {
                if (data["status"] == "error") {
                    throw_error();
                } else {

                    // Change button color
                    if (data["message"] == "processing") {
                        //setStatus(3);
                    }

                    if (data["message"] == "waiting") {
                        //setStatus(2);
                    }

                    // Waiting for translation, check it again in 100ms
                    if ((data["message"] == "processing") || (data["message"] == "waiting")) {
                        setTimeout(get_translation_status, 100);
                    }

                    // Our translation its done
                    if (data["message"] == "processed") {
                        //setStatus(4);
                        get_translation();
                    }

                    // Error while processing translation
                    if (data["message"] == "failed") {
                        throw_error();
                    }
                }
            }
        })
    }
    
    function get_translation() {
    	
    	var model = "eu2es";
    	//var model = "es2eu";
    	var model_send = "";
    	var host = "";
    	var masterkey = ""; 
    	if(model == "es2eu"){
            model_send = "generic_es2eu"
            host = "eseu.itzuli.euskadi.eus"
            masterkey = "5dbb8428-51b4-4c47-bfdc-a7762595fe74"
    	} else {
    		model_send = "generic_eu2es"
            host = "eues.itzuli.euskadi.eus"
            masterkey = "5dbb8428-51b4-4c47-bfdc-a7762595fe74"
    	}
        
        // If translation status is processed, we can ask for translation info
        $.ajax({
            url: "https://cors-anywhere.herokuapp.com/https://"+host+"/job/" + user_key_job + "/get",
            type: 'POST',
            data: '{ "mkey" : "'+masterkey+'" }',
            dataType: 'json',
            crossDomain: true,
            /*xhrFields: {
                withCredentials: true
            },*/
            success: function(data) {
                if (data["status"] == 4) {
                    throw_error();
                } else {
                    if (data["status"] == 3) {
                        alert(data["message"]);
                    }
                }	
            }, complete: function(data) {
            	//alert("get_translation: " +data["message"]);
            	// final!
            }
        });
    }
    
    function doTranslate() {

    	var model = "eu2es";
    	//var model = "es2eu";
    	var model_send = "";
    	var host = "";
    	var masterkey = ""; 
    	if(model == "es2eu"){
            model_send = "generic_es2eu"
            host = "eseu.itzuli.euskadi.eus"
            masterkey = "5dbb8428-51b4-4c47-bfdc-a7762595fe74"
    	} else {
    		model_send = "generic_eu2es"
            host = "eues.itzuli.euskadi.eus"
            masterkey = "5dbb8428-51b4-4c47-bfdc-a7762595fe74"
    	}
  
	    var user_key = "fD6JZAFQvU";
	    // Get user key to start processing our job
	    $.ajax({
	        url: "https://cors-anywhere.herokuapp.com/https://"+host+"/key/get",
	        type: 'POST',
	        data: '{ "mkey": "'+masterkey+'" }',
	        dataType: 'json',
	        crossDomain: true,
	        /*xhrFields: {
	            withCredentials: true
	        },*/
	        success: function(data_key) {

	            //user_key = data_key["ukey"];
	        	
	        	user_key_job = data_key["ukey"];
	        	
	            // Add new translation job with received user key
	        	var myText = $('blockquote p').text();
	        	//alert("Texto a traducir: " + myText);
	            var send = {mkey:masterkey, ukey:user_key_job, text:myText, model:model_send};
	            $.ajax({
	                url: "https://cors-anywhere.herokuapp.com/https://"+host+"/job/add",
	                type: 'POST',
	                data: JSON.stringify(send),
	                dataType: 'json',
	                crossDomain: true,
	                /*xhrFields: {
	                    withCredentials: true
	                },*/
	                success: function (data) {
	                    if (data["status"] == "error") {
	                            throw_error();
	                    } else {
	                            setTimeout(get_translation_status, 100); // Get translation status in 100ms
	                    }
	                }
	            })
	        },
	        error: function(XMLHttpRequest, textStatus, errorThrown) {
	            alert("some error");
	            alert(errorThrown);
	        }
	    });

	}
    $('#adjust').click(function () {
        step3();
        changeStep(3);
    });

    $('#go-back').click(function () {
        changeStep(2);
    });

    $('#start-over').click(function () {
        changeStep(1);
    });

    $('#translate').click(function () {
    	translate();
    });
    
    function translate() {
    	alert("translate " + $('blockquote p').text());
    	doTranslate();
    	//alert($("button[data-id='btn_translate']").text());    	
    }
    
    $('.nav').on('click', 'a', function () {
        if (!$(this).parent().is('.disabled')) {
            var step = $(this).data('step');
            changeStep(step);
        }

        return false;
    });
})();
