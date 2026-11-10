# Public API reference

Generated from the exact root exports for **@photivra/engine 2.19.0 / root contract 2.19.0** by `node scripts/generate-api-reference.mjs`. No module deep import is supported.

Use [the developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md) for executable paths and scientific boundaries. Types are contracts, not runtime validation: parse untrusted data, preserve units/reference frames, read assessment blockers, and retain evidence/limitations. Optional properties do not imply a universal default. Model/schema IDs remain independent of the distribution.

## Task index

Start here to find a function by task. [Using Photivra from an agent](AGENT_GUIDE.md) gives units, result reading and errors.

| Task | Functions |
| --- | --- |
| Simulate a full photo (async) | [`simulateCapture`](api/facade-simulate-capture.md#simulatecapture) |
| Preview a whole frame as the real capture resized (async) | [`simulateDisplayView`](api/facade-simulate-display-view.md#simulatedisplayview) |
| Exposure value and equivalent settings | [`calculateExposureValue100`](api/exposure-exposure.md#calculateexposurevalue100), [`calculateEquivalentIso`](api/exposure-exposure.md#calculateequivalentiso), [`calculateRelativeRenderedExposure`](api/exposure-exposure.md#calculaterelativerenderedexposure) |
| Depth of field, hyperfocal distance and defocus blur | [`calculateDepthOfField`](api/optics-depth-of-field.md#calculatedepthoffield), [`calculateDefocusCircle`](api/optics-depth-of-field.md#calculatedefocuscircle) |
| Field of view | [`calculateFieldOfView`](api/camera-field-of-view.md#calculatefieldofview) |
| Crop factor, 35 mm-equivalent focal length and crops | [`calculateEquivalentFocalLength35Mm`](api/camera-equivalent-focal-length.md#calculateequivalentfocallength35mm), [`calculateCenteredCrop`](api/output-crop.md#calculatecenteredcrop), [`calculateCropToMatchFocalLength`](api/output-crop-to-match-focal-length.md#calculatecroptomatchfocallength) |
| Aperture (entrance-pupil) diameter | [`calculateApertureDiameter`](api/optics-aperture-diameter.md#calculateaperturediameter) |
| Equivalent f-number, sensor area and blur as a share of the frame | [`calculateSensorEquivalence`](api/camera-sensor-equivalence.md#calculatesensorequivalence), [`calculateBlurShareOfFrame`](api/camera-sensor-equivalence.md#calculateblurshareofframe) |
| Motion blur and shutter speed | [`calculateProjectedMotionBlur`](api/motion-projected-motion.md#calculateprojectedmotionblur), [`calculateShutterAngleExposureSeconds`](api/motion-video-sequence.md#calculateshutterangleexposureseconds) |
| Shutter time with an ND filter | [`calculateFilteredExposureTime`](api/exposure-filtered-exposure-time.md#calculatefilteredexposuretime) |
| Diffraction | [`calculateAiryDisk`](api/optics-diffraction.md#calculateairydisk) |
| Which limits detail: the lens or the sensor | [`calculateDetailLimit`](api/optics-detail-limit.md#calculatedetaillimit) |
| Sensor signal, noise and SNR | [`calculatePhotoelectrons`](api/sensor-signal-noise.md#calculatephotoelectrons), [`calculateSignalToNoise`](api/sensor-signal-noise.md#calculatesignaltonoise) |
| Colour temperature | [`calculateChromaticityFromCorrelatedColorTemperature`](api/color-illuminants.md#calculatechromaticityfromcorrelatedcolortemperature), [`calculateCorrelatedColorTemperature`](api/color-illuminants.md#calculatecorrelatedcolortemperature) |
| White balance from Kelvin and tint | [`createColorTemperatureWhiteBalanceIntent`](api/color-white-balance.md#createcolortemperaturewhitebalanceintent), [`resolveColorTemperatureWhiteBalance`](api/color-white-balance.md#resolvecolortemperaturewhitebalance) |

## camera/equivalent-focal-length.ts

[Detailed contracts](api/camera-equivalent-focal-length.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/camera/equivalent-focal-length.ts)

| Export | Kind |
| --- | --- |
| [`calculateEquivalentFocalLength35Mm`](api/camera-equivalent-focal-length.md#calculateequivalentfocallength35mm) | Runtime |
| [`CalculateEquivalentFocalLength35MmInput`](api/camera-equivalent-focal-length.md#calculateequivalentfocallength35mminput) | Type |
| [`EquivalentFocalLength35Mm`](api/camera-equivalent-focal-length.md#equivalentfocallength35mm) | Type |

## camera/field-of-view.ts

[Detailed contracts](api/camera-field-of-view.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/camera/field-of-view.ts)

| Export | Kind |
| --- | --- |
| [`calculateFieldOfView`](api/camera-field-of-view.md#calculatefieldofview) | Runtime |
| [`calculateFieldOfViewBounds`](api/camera-field-of-view.md#calculatefieldofviewbounds) | Runtime |
| [`CalculateFieldOfViewBoundsInput`](api/camera-field-of-view.md#calculatefieldofviewboundsinput) | Type |
| [`CalculateFieldOfViewInput`](api/camera-field-of-view.md#calculatefieldofviewinput) | Type |
| [`FieldOfView`](api/camera-field-of-view.md#fieldofview) | Type |
| [`FieldOfViewBounds`](api/camera-field-of-view.md#fieldofviewbounds) | Type |

## camera/lens-projection.ts

[Detailed contracts](api/camera-lens-projection.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/camera/lens-projection.ts)

| Export | Kind |
| --- | --- |
| [`calculateLensProjectionDirection`](api/camera-lens-projection.md#calculatelensprojectiondirection) | Runtime |
| [`CalculateLensProjectionDirectionInput`](api/camera-lens-projection.md#calculatelensprojectiondirectioninput) | Type |
| [`calculateLensProjectionFieldOfView`](api/camera-lens-projection.md#calculatelensprojectionfieldofview) | Runtime |
| [`calculateLensProjectionFieldOfViewBounds`](api/camera-lens-projection.md#calculatelensprojectionfieldofviewbounds) | Runtime |
| [`CalculateLensProjectionFieldOfViewBoundsInput`](api/camera-lens-projection.md#calculatelensprojectionfieldofviewboundsinput) | Type |
| [`CalculateLensProjectionFieldOfViewInput`](api/camera-lens-projection.md#calculatelensprojectionfieldofviewinput) | Type |
| [`calculateLensProjectionImagePoint`](api/camera-lens-projection.md#calculatelensprojectionimagepoint) | Runtime |
| [`CalculateLensProjectionImagePointInput`](api/camera-lens-projection.md#calculatelensprojectionimagepointinput) | Type |
| [`LENS_PROJECTION_MODELS`](api/camera-lens-projection.md#lens_projection_models) | Runtime |
| [`LensDirection`](api/camera-lens-projection.md#lensdirection) | Type |
| [`LensProjectionDirection`](api/camera-lens-projection.md#lensprojectiondirection) | Type |
| [`LensProjectionFieldOfView`](api/camera-lens-projection.md#lensprojectionfieldofview) | Type |
| [`LensProjectionFieldOfViewBounds`](api/camera-lens-projection.md#lensprojectionfieldofviewbounds) | Type |
| [`LensProjectionImagePoint`](api/camera-lens-projection.md#lensprojectionimagepoint) | Type |
| [`LensProjectionModel`](api/camera-lens-projection.md#lensprojectionmodel) | Type |
| [`parseLensProjectionModel`](api/camera-lens-projection.md#parselensprojectionmodel) | Runtime |
| [`RadialLensProjectionModel`](api/camera-lens-projection.md#radiallensprojectionmodel) | Type |

## camera/projected-object-size.ts

[Detailed contracts](api/camera-projected-object-size.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/camera/projected-object-size.ts)

| Export | Kind |
| --- | --- |
| [`calculateProjectedObjectSize`](api/camera-projected-object-size.md#calculateprojectedobjectsize) | Runtime |
| [`CalculateProjectedObjectSizeInput`](api/camera-projected-object-size.md#calculateprojectedobjectsizeinput) | Type |
| [`ProjectedObjectSize`](api/camera-projected-object-size.md#projectedobjectsize) | Type |

## camera/sensor-equivalence.ts

[Detailed contracts](api/camera-sensor-equivalence.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/camera/sensor-equivalence.ts)

| Export | Kind |
| --- | --- |
| [`BlurShareOfFrame`](api/camera-sensor-equivalence.md#blurshareofframe) | Type |
| [`BlurShareOfPrint`](api/camera-sensor-equivalence.md#blurshareofprint) | Type |
| [`calculateBlurShareOfFrame`](api/camera-sensor-equivalence.md#calculateblurshareofframe) | Runtime |
| [`CalculateBlurShareOfFrameInput`](api/camera-sensor-equivalence.md#calculateblurshareofframeinput) | Type |
| [`calculateSensorEquivalence`](api/camera-sensor-equivalence.md#calculatesensorequivalence) | Runtime |
| [`CalculateSensorEquivalenceInput`](api/camera-sensor-equivalence.md#calculatesensorequivalenceinput) | Type |
| [`EquivalenceExactness`](api/camera-sensor-equivalence.md#equivalenceexactness) | Type |
| [`EquivalenceValueBasis`](api/camera-sensor-equivalence.md#equivalencevaluebasis) | Type |
| [`SensorEquivalence`](api/camera-sensor-equivalence.md#sensorequivalence) | Type |
| [`SensorEquivalenceFieldOfView`](api/camera-sensor-equivalence.md#sensorequivalencefieldofview) | Type |
| [`SensorEquivalenceQuantity`](api/camera-sensor-equivalence.md#sensorequivalencequantity) | Type |

## capture/capture-export-metadata.ts

[Detailed contracts](api/capture-capture-export-metadata.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/capture-export-metadata.ts)

| Export | Kind |
| --- | --- |
| [`CAPTURE_EXPORT_METADATA_SCHEMA_VERSION`](api/capture-capture-export-metadata.md#capture_export_metadata_schema_version) | Runtime |
| [`CaptureExportArtifactIdentity`](api/capture-capture-export-metadata.md#captureexportartifactidentity) | Type |
| [`CaptureExportMetadataInput`](api/capture-capture-export-metadata.md#captureexportmetadatainput) | Type |
| [`CaptureExportMetadataPair`](api/capture-capture-export-metadata.md#captureexportmetadatapair) | Type |
| [`CaptureExportSharedMetadata`](api/capture-capture-export-metadata.md#captureexportsharedmetadata) | Type |
| [`CaptureExportWorkflow`](api/capture-capture-export-metadata.md#captureexportworkflow) | Type |
| [`createCaptureExportMetadataPair`](api/capture-capture-export-metadata.md#createcaptureexportmetadatapair) | Runtime |
| [`parseCaptureExportMetadataInput`](api/capture-capture-export-metadata.md#parsecaptureexportmetadatainput) | Runtime |

## capture/dng-import.ts

[Detailed contracts](api/capture-dng-import.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/dng-import.ts)

| Export | Kind |
| --- | --- |
| [`DNG_IMPORT_LIMITS`](api/capture-dng-import.md#dng_import_limits) | Runtime |
| [`DNG_IMPORT_SCHEMA_VERSION`](api/capture-dng-import.md#dng_import_schema_version) | Runtime |
| [`DngImportInput`](api/capture-dng-import.md#dngimportinput) | Type |
| [`ImportedDngBlackLevel`](api/capture-dng-import.md#importeddngblacklevel) | Type |
| [`ImportedDngCfa`](api/capture-dng-import.md#importeddngcfa) | Type |
| [`ImportedDngRaw`](api/capture-dng-import.md#importeddngraw) | Type |
| [`ImportedDngRect`](api/capture-dng-import.md#importeddngrect) | Type |
| [`parseDngRawImage`](api/capture-dng-import.md#parsedngrawimage) | Runtime |

## capture/environment-raw-producer.ts

[Detailed contracts](api/capture-environment-raw-producer.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/environment-raw-producer.ts)

| Export | Kind |
| --- | --- |
| [`EnvironmentSensorRawFrame`](api/capture-environment-raw-producer.md#environmentsensorrawframe) | Type |
| [`simulateEnvironmentSensorRawFrame`](api/capture-environment-raw-producer.md#simulateenvironmentsensorrawframe) | Runtime |
| [`SimulateEnvironmentSensorRawFrameInput`](api/capture-environment-raw-producer.md#simulateenvironmentsensorrawframeinput) | Type |

## capture/export-jpeg.ts

[Detailed contracts](api/capture-export-jpeg.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/export-jpeg.ts)

| Export | Kind |
| --- | --- |
| [`EXPORT_JPEG_ENCODER_ID`](api/capture-export-jpeg.md#export_jpeg_encoder_id) | Runtime |
| [`JpegStripBits`](api/capture-export-jpeg.md#jpegstripbits) | Type |

## capture/focus-control.ts

[Detailed contracts](api/capture-focus-control.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/focus-control.ts)

| Export | Kind |
| --- | --- |
| [`assessFocusReleaseGate`](api/capture-focus-control.md#assessfocusreleasegate) | Runtime |
| [`AssessFocusReleaseGateInput`](api/capture-focus-control.md#assessfocusreleasegateinput) | Type |
| [`createFocusControlState`](api/capture-focus-control.md#createfocuscontrolstate) | Runtime |
| [`CreateFocusControlStateInput`](api/capture-focus-control.md#createfocuscontrolstateinput) | Type |
| [`FOCUS_CONTROL_PROFILE_SCHEMA_VERSION`](api/capture-focus-control.md#focus_control_profile_schema_version) | Runtime |
| [`FOCUS_CONTROL_STATE_VERSION`](api/capture-focus-control.md#focus_control_state_version) | Runtime |
| [`FocusAcquisitionState`](api/capture-focus-control.md#focusacquisitionstate) | Type |
| [`FocusControlMode`](api/capture-focus-control.md#focuscontrolmode) | Type |
| [`FocusControlProfile`](api/capture-focus-control.md#focuscontrolprofile) | Type |
| [`FocusControlState`](api/capture-focus-control.md#focuscontrolstate) | Type |
| [`FocusReleaseGateAssessment`](api/capture-focus-control.md#focusreleasegateassessment) | Type |
| [`FocusReleasePriority`](api/capture-focus-control.md#focusreleasepriority) | Type |
| [`FocusTargetControlEvent`](api/capture-focus-control.md#focustargetcontrolevent) | Type |
| [`FocusTargetLossReason`](api/capture-focus-control.md#focustargetlossreason) | Type |
| [`FocusTargetObservation`](api/capture-focus-control.md#focustargetobservation) | Type |
| [`FocusTargetResolution`](api/capture-focus-control.md#focustargetresolution) | Type |
| [`parseFocusControlProfile`](api/capture-focus-control.md#parsefocuscontrolprofile) | Runtime |
| [`resolveFocusTargetObservation`](api/capture-focus-control.md#resolvefocustargetobservation) | Runtime |
| [`ResolveFocusTargetObservationInput`](api/capture-focus-control.md#resolvefocustargetobservationinput) | Type |
| [`setFocusLock`](api/capture-focus-control.md#setfocuslock) | Runtime |
| [`SetFocusLockInput`](api/capture-focus-control.md#setfocuslockinput) | Type |
| [`setManualFocusState`](api/capture-focus-control.md#setmanualfocusstate) | Runtime |
| [`SetManualFocusStateInput`](api/capture-focus-control.md#setmanualfocusstateinput) | Type |

## capture/linear-encoding.ts

[Detailed contracts](api/capture-linear-encoding.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/linear-encoding.ts)

| Export | Kind |
| --- | --- |
| [`calculateLinearCaptureEncoding`](api/capture-linear-encoding.md#calculatelinearcaptureencoding) | Runtime |
| [`EncodedLinearCapture`](api/capture-linear-encoding.md#encodedlinearcapture) | Type |
| [`LINEAR_CAPTURE_ENCODING_MODEL_VERSION`](api/capture-linear-encoding.md#linear_capture_encoding_model_version) | Runtime |
| [`LINEAR_CAPTURE_ENCODING_SCHEMA_VERSION`](api/capture-linear-encoding.md#linear_capture_encoding_schema_version) | Runtime |
| [`LinearCaptureEncoding`](api/capture-linear-encoding.md#linearcaptureencoding) | Type |
| [`LinearCaptureEncodingInput`](api/capture-linear-encoding.md#linearcaptureencodinginput) | Type |
| [`parseLinearCaptureEncoding`](api/capture-linear-encoding.md#parselinearcaptureencoding) | Runtime |

## capture/lossless-jpeg.ts

[Detailed contracts](api/capture-lossless-jpeg.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/lossless-jpeg.ts)

| Export | Kind |
| --- | --- |
| [`LosslessJpegImage`](api/capture-lossless-jpeg.md#losslessjpegimage) | Type |
| [`LosslessJpegLimits`](api/capture-lossless-jpeg.md#losslessjpeglimits) | Type |
| [`parseLosslessJpeg`](api/capture-lossless-jpeg.md#parselosslessjpeg) | Runtime |

## capture/native-environment-optical-stage.ts

[Detailed contracts](api/capture-native-environment-optical-stage.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/native-environment-optical-stage.ts)

| Export | Kind |
| --- | --- |
| [`NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS`](api/capture-native-environment-optical-stage.md#native_environment_optical_stage_limits) | Runtime |
| [`NativeEnvironmentOpticalStage`](api/capture-native-environment-optical-stage.md#nativeenvironmentopticalstage) | Type |
| [`NativeEnvironmentOpticalStageRetention`](api/capture-native-environment-optical-stage.md#nativeenvironmentopticalstageretention) | Type |
| [`NativeEnvironmentSensorStageInput`](api/capture-native-environment-optical-stage.md#nativeenvironmentsensorstageinput) | Type |
| [`NativeEnvironmentSensorStageProvider`](api/capture-native-environment-optical-stage.md#nativeenvironmentsensorstageprovider) | Type |

## capture/native-environment-raw.ts

[Detailed contracts](api/capture-native-environment-raw.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/native-environment-raw.ts)

| Export | Kind |
| --- | --- |
| [`calculateNativeRawRowBands`](api/capture-native-environment-raw.md#calculatenativerawrowbands) | Runtime |
| [`composeNativeEnvironmentRawPartitions`](api/capture-native-environment-raw.md#composenativeenvironmentrawpartitions) | Runtime |
| [`createNativeEnvironmentRawPartitionTask`](api/capture-native-environment-raw.md#createnativeenvironmentrawpartitiontask) | Runtime |
| [`createNativeEnvironmentRawTask`](api/capture-native-environment-raw.md#createnativeenvironmentrawtask) | Runtime |
| [`createNativeEnvironmentSensorStageTask`](api/capture-native-environment-raw.md#createnativeenvironmentsensorstagetask) | Runtime |
| [`NativeEnvironmentPhotoTile`](api/capture-native-environment-raw.md#nativeenvironmentphototile) | Type |
| [`NativeEnvironmentRadianceQuery`](api/capture-native-environment-raw.md#nativeenvironmentradiancequery) | Type |
| [`NativeEnvironmentRawInput`](api/capture-native-environment-raw.md#nativeenvironmentrawinput) | Type |
| [`NativeEnvironmentRawOutput`](api/capture-native-environment-raw.md#nativeenvironmentrawoutput) | Type |
| [`NativeEnvironmentRawPartition`](api/capture-native-environment-raw.md#nativeenvironmentrawpartition) | Type |
| [`NativeEnvironmentRawPartitionTask`](api/capture-native-environment-raw.md#nativeenvironmentrawpartitiontask) | Type |
| [`NativeEnvironmentRawProvider`](api/capture-native-environment-raw.md#nativeenvironmentrawprovider) | Type |
| [`NativeEnvironmentRawTask`](api/capture-native-environment-raw.md#nativeenvironmentrawtask) | Type |
| [`NativeEnvironmentRawTile`](api/capture-native-environment-raw.md#nativeenvironmentrawtile) | Type |
| [`NativeRawRowBand`](api/capture-native-environment-raw.md#nativerawrowband) | Type |

## capture/native-raw-development.ts

[Detailed contracts](api/capture-native-raw-development.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/native-raw-development.ts)

| Export | Kind |
| --- | --- |
| [`createNativeRawDevelopmentTask`](api/capture-native-raw-development.md#createnativerawdevelopmenttask) | Runtime |
| [`NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS`](api/capture-native-raw-development.md#native_raw_development_exposure_range_stops) | Runtime |
| [`NativeRawDevelopmentInput`](api/capture-native-raw-development.md#nativerawdevelopmentinput) | Type |
| [`NativeRawDevelopmentOutput`](api/capture-native-raw-development.md#nativerawdevelopmentoutput) | Type |
| [`NativeRawDevelopmentProvider`](api/capture-native-raw-development.md#nativerawdevelopmentprovider) | Type |
| [`NativeRawDevelopmentTask`](api/capture-native-raw-development.md#nativerawdevelopmenttask) | Type |
| [`RawHighlightDiagnostics`](api/capture-native-raw-development.md#rawhighlightdiagnostics) | Type |

## capture/native-raw-dng.ts

[Detailed contracts](api/capture-native-raw-dng.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/native-raw-dng.ts)

| Export | Kind |
| --- | --- |
| [`NATIVE_RAW_DNG_SCHEMA_VERSION`](api/capture-native-raw-dng.md#native_raw_dng_schema_version) | Runtime |
| [`NativeRawDng`](api/capture-native-raw-dng.md#nativerawdng) | Type |
| [`NativeRawDngChannelNoise`](api/capture-native-raw-dng.md#nativerawdngchannelnoise) | Type |
| [`serializeNativeRawDng`](api/capture-native-raw-dng.md#serializenativerawdng) | Runtime |
| [`SerializeNativeRawDngInput`](api/capture-native-raw-dng.md#serializenativerawdnginput) | Type |

## capture/native-raw.ts

[Detailed contracts](api/capture-native-raw.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/native-raw.ts)

| Export | Kind |
| --- | --- |
| [`calculateNativeRawPlan`](api/capture-native-raw.md#calculatenativerawplan) | Runtime |
| [`createNativeRawTask`](api/capture-native-raw.md#createnativerawtask) | Runtime |
| [`NATIVE_RAW_LIMITS`](api/capture-native-raw.md#native_raw_limits) | Runtime |
| [`NATIVE_RAW_SCHEMA_VERSION`](api/capture-native-raw.md#native_raw_schema_version) | Runtime |
| [`NativeRawExposure`](api/capture-native-raw.md#nativerawexposure) | Type |
| [`NativeRawExposureInput`](api/capture-native-raw.md#nativerawexposureinput) | Type |
| [`NativeRawInput`](api/capture-native-raw.md#nativerawinput) | Type |
| [`NativeRawOutput`](api/capture-native-raw.md#nativerawoutput) | Type |
| [`NativeRawPlan`](api/capture-native-raw.md#nativerawplan) | Type |
| [`NativeRawProvider`](api/capture-native-raw.md#nativerawprovider) | Type |
| [`NativeRawTask`](api/capture-native-raw.md#nativerawtask) | Type |
| [`NativeRawTaskState`](api/capture-native-raw.md#nativerawtaskstate) | Type |
| [`NativeRawTile`](api/capture-native-raw.md#nativerawtile) | Type |
| [`NativeRawTileRequest`](api/capture-native-raw.md#nativerawtilerequest) | Type |

## capture/packed-sensor-raw.ts

[Detailed contracts](api/capture-packed-sensor-raw.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/packed-sensor-raw.ts)

| Export | Kind |
| --- | --- |
| [`calculatePackedSensorRawPlan`](api/capture-packed-sensor-raw.md#calculatepackedsensorrawplan) | Runtime |
| [`PACKED_SENSOR_RAW_LIMITS`](api/capture-packed-sensor-raw.md#packed_sensor_raw_limits) | Runtime |
| [`PACKED_SENSOR_RAW_SCHEMA_VERSION`](api/capture-packed-sensor-raw.md#packed_sensor_raw_schema_version) | Runtime |
| [`PackedSensorAdditionalChargeComponent`](api/capture-packed-sensor-raw.md#packedsensoradditionalchargecomponent) | Type |
| [`PackedSensorFixedPatternNoise`](api/capture-packed-sensor-raw.md#packedsensorfixedpatternnoise) | Type |
| [`PackedSensorRawDiagnostics`](api/capture-packed-sensor-raw.md#packedsensorrawdiagnostics) | Type |
| [`PackedSensorRawInput`](api/capture-packed-sensor-raw.md#packedsensorrawinput) | Type |
| [`PackedSensorRawPlan`](api/capture-packed-sensor-raw.md#packedsensorrawplan) | Type |
| [`PackedSensorRawResult`](api/capture-packed-sensor-raw.md#packedsensorrawresult) | Type |
| [`simulatePackedSensorRaw`](api/capture-packed-sensor-raw.md#simulatepackedsensorraw) | Runtime |

## capture/photographic-export.ts

[Detailed contracts](api/capture-photographic-export.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/photographic-export.ts)

| Export | Kind |
| --- | --- |
| [`calculateProcessedSensorRaw`](api/capture-photographic-export.md#calculateprocessedsensorraw) | Runtime |
| [`createPhotographicExportPair`](api/capture-photographic-export.md#createphotographicexportpair) | Runtime |
| [`ExportSensorColorProfile`](api/capture-photographic-export.md#exportsensorcolorprofile) | Type |
| [`parseExportSensorColorProfile`](api/capture-photographic-export.md#parseexportsensorcolorprofile) | Runtime |
| [`parsePhotographicExportInput`](api/capture-photographic-export.md#parsephotographicexportinput) | Runtime |
| [`parseProcessedSensorRawInput`](api/capture-photographic-export.md#parseprocessedsensorrawinput) | Runtime |
| [`PHOTOGRAPHIC_EXPORT_PIPELINE_VERSION`](api/capture-photographic-export.md#photographic_export_pipeline_version) | Runtime |
| [`PHOTOGRAPHIC_EXPORT_SCHEMA_VERSION`](api/capture-photographic-export.md#photographic_export_schema_version) | Runtime |
| [`PhotographicExportInput`](api/capture-photographic-export.md#photographicexportinput) | Type |
| [`PhotographicExportOptions`](api/capture-photographic-export.md#photographicexportoptions) | Type |
| [`PhotographicExportPair`](api/capture-photographic-export.md#photographicexportpair) | Type |
| [`PROCESSED_SENSOR_RAW_MODEL_VERSION`](api/capture-photographic-export.md#processed_sensor_raw_model_version) | Runtime |
| [`ProcessedSensorRawInput`](api/capture-photographic-export.md#processedsensorrawinput) | Type |
| [`ProcessedSensorRawResult`](api/capture-photographic-export.md#processedsensorrawresult) | Type |

## capture/raw-frame-reconstruction.ts

[Detailed contracts](api/capture-raw-frame-reconstruction.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/raw-frame-reconstruction.ts)

| Export | Kind |
| --- | --- |
| [`parseRawFrameReconstructionInput`](api/capture-raw-frame-reconstruction.md#parserawframereconstructioninput) | Runtime |
| [`RAW_FRAME_RECONSTRUCTION_SCHEMA_VERSION`](api/capture-raw-frame-reconstruction.md#raw_frame_reconstruction_schema_version) | Runtime |
| [`RawFrameReconstruction`](api/capture-raw-frame-reconstruction.md#rawframereconstruction) | Type |
| [`RawFrameReconstructionInput`](api/capture-raw-frame-reconstruction.md#rawframereconstructioninput) | Type |
| [`RawFrameReconstructionPhaseProfile`](api/capture-raw-frame-reconstruction.md#rawframereconstructionphaseprofile) | Type |
| [`resolveRawFrameReconstruction`](api/capture-raw-frame-reconstruction.md#resolverawframereconstruction) | Runtime |

## capture/raw-white-level.ts

[Detailed contracts](api/capture-raw-white-level.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/raw-white-level.ts)

| Export | Kind |
| --- | --- |
| [`calculateEffectiveSaturationCode`](api/capture-raw-white-level.md#calculateeffectivesaturationcode) | Runtime |
| [`EffectiveSaturationReadout`](api/capture-raw-white-level.md#effectivesaturationreadout) | Type |

## capture/release-sequence.ts

[Detailed contracts](api/capture-release-sequence.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/release-sequence.ts)

| Export | Kind |
| --- | --- |
| [`CancelledReleaseSequence`](api/capture-release-sequence.md#cancelledreleasesequence) | Type |
| [`CancelReleaseSequenceInput`](api/capture-release-sequence.md#cancelreleasesequenceinput) | Type |
| [`createCancelledReleaseSequence`](api/capture-release-sequence.md#createcancelledreleasesequence) | Runtime |
| [`RELEASE_SEQUENCE_VERSION`](api/capture-release-sequence.md#release_sequence_version) | Runtime |
| [`ReleaseAutomationState`](api/capture-release-sequence.md#releaseautomationstate) | Type |
| [`ReleaseBaseCaptureState`](api/capture-release-sequence.md#releasebasecapturestate) | Type |
| [`ReleaseBracketPolicy`](api/capture-release-sequence.md#releasebracketpolicy) | Type |
| [`ReleaseDrivePolicy`](api/capture-release-sequence.md#releasedrivepolicy) | Type |
| [`ReleaseTimingConstraint`](api/capture-release-sequence.md#releasetimingconstraint) | Type |
| [`ResolvedReleaseFrame`](api/capture-release-sequence.md#resolvedreleaseframe) | Type |
| [`ResolvedReleaseSequence`](api/capture-release-sequence.md#resolvedreleasesequence) | Type |
| [`resolveReleaseSequence`](api/capture-release-sequence.md#resolvereleasesequence) | Runtime |
| [`ResolveReleaseSequenceInput`](api/capture-release-sequence.md#resolvereleasesequenceinput) | Type |

## capture/sensor-raw-frame.ts

[Detailed contracts](api/capture-sensor-raw-frame.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/sensor-raw-frame.ts)

| Export | Kind |
| --- | --- |
| [`createSensorRawFrame`](api/capture-sensor-raw-frame.md#createsensorrawframe) | Runtime |
| [`parseSensorRawFrameInput`](api/capture-sensor-raw-frame.md#parsesensorrawframeinput) | Runtime |
| [`SENSOR_RAW_FRAME_SCHEMA_VERSION`](api/capture-sensor-raw-frame.md#sensor_raw_frame_schema_version) | Runtime |
| [`SensorRawFrame`](api/capture-sensor-raw-frame.md#sensorrawframe) | Type |
| [`SensorRawFrameInput`](api/capture-sensor-raw-frame.md#sensorrawframeinput) | Type |

## capture/sensor-raw-producer.ts

[Detailed contracts](api/capture-sensor-raw-producer.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/sensor-raw-producer.ts)

| Export | Kind |
| --- | --- |
| [`parseSensorRawProducerInput`](api/capture-sensor-raw-producer.md#parsesensorrawproducerinput) | Runtime |
| [`SENSOR_RAW_PRODUCER_NOISE_MODEL`](api/capture-sensor-raw-producer.md#sensor_raw_producer_noise_model) | Runtime |
| [`SENSOR_RAW_PRODUCER_SCHEMA_VERSION`](api/capture-sensor-raw-producer.md#sensor_raw_producer_schema_version) | Runtime |
| [`SensorRawProducerExposureWindowInput`](api/capture-sensor-raw-producer.md#sensorrawproducerexposurewindowinput) | Type |
| [`SensorRawProducerInput`](api/capture-sensor-raw-producer.md#sensorrawproducerinput) | Type |
| [`SensorRawProducerResult`](api/capture-sensor-raw-producer.md#sensorrawproducerresult) | Type |
| [`SensorRawProducerSiteInput`](api/capture-sensor-raw-producer.md#sensorrawproducersiteinput) | Type |
| [`simulateSensorRawFrame`](api/capture-sensor-raw-producer.md#simulatesensorrawframe) | Runtime |

## capture/simulated-capture.ts

[Detailed contracts](api/capture-simulated-capture.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/capture/simulated-capture.ts)

| Export | Kind |
| --- | --- |
| [`CaptureExposureSource`](api/capture-simulated-capture.md#captureexposuresource) | Type |
| [`CaptureFloatStorage`](api/capture-simulated-capture.md#capturefloatstorage) | Type |
| [`CaptureLinearImageState`](api/capture-simulated-capture.md#capturelinearimagestate) | Type |
| [`CaptureLinearPlane`](api/capture-simulated-capture.md#capturelinearplane) | Type |
| [`CapturePublicProfileReference`](api/capture-simulated-capture.md#capturepublicprofilereference) | Type |
| [`CaptureWhiteBalanceIntent`](api/capture-simulated-capture.md#capturewhitebalanceintent) | Type |
| [`CaptureWhiteXyz`](api/capture-simulated-capture.md#capturewhitexyz) | Type |
| [`createCaptureWhiteBalanceIntent`](api/capture-simulated-capture.md#createcapturewhitebalanceintent) | Runtime |
| [`createSimulatedCapture`](api/capture-simulated-capture.md#createsimulatedcapture) | Runtime |
| [`parseSimulatedCapture`](api/capture-simulated-capture.md#parsesimulatedcapture) | Runtime |
| [`resolveSimulatedCapturePlane`](api/capture-simulated-capture.md#resolvesimulatedcaptureplane) | Runtime |
| [`serializeSimulatedCapture`](api/capture-simulated-capture.md#serializesimulatedcapture) | Runtime |
| [`SIMULATED_CAPTURE_SCHEMA_VERSION`](api/capture-simulated-capture.md#simulated_capture_schema_version) | Runtime |
| [`SimulatedCapture`](api/capture-simulated-capture.md#simulatedcapture) | Type |
| [`SimulatedCaptureInput`](api/capture-simulated-capture.md#simulatedcaptureinput) | Type |

## color/camera-color-matrix.ts

[Detailed contracts](api/color-camera-color-matrix.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/camera-color-matrix.ts)

| Export | Kind |
| --- | --- |
| [`CameraColorMatrixFit`](api/color-camera-color-matrix.md#cameracolormatrixfit) | Type |
| [`CameraMatrixFitConstraint`](api/color-camera-color-matrix.md#cameramatrixfitconstraint) | Type |
| [`CameraMatrixPatchReport`](api/color-camera-color-matrix.md#cameramatrixpatchreport) | Type |
| [`CameraMatrixTrainingPatch`](api/color-camera-color-matrix.md#cameramatrixtrainingpatch) | Type |
| [`CameraSpectralSensitivities`](api/color-camera-color-matrix.md#cameraspectralsensitivities) | Type |
| [`estimateCameraColorMatrix`](api/color-camera-color-matrix.md#estimatecameracolormatrix) | Runtime |
| [`EstimateCameraColorMatrixInput`](api/color-camera-color-matrix.md#estimatecameracolormatrixinput) | Type |
| [`MAX_CAMERA_MATRIX_TRAINING_PATCHES`](api/color-camera-color-matrix.md#max_camera_matrix_training_patches) | Runtime |

## color/capture-color.ts

[Detailed contracts](api/color-capture-color.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/capture-color.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureColorTransform`](api/color-capture-color.md#calculatecapturecolortransform) | Runtime |
| [`CAPTURE_COLOR_MODEL_VERSION`](api/color-capture-color.md#capture_color_model_version) | Runtime |
| [`CaptureChromaticAdaptationTransform`](api/color-capture-color.md#capturechromaticadaptationtransform) | Type |
| [`CaptureColorModel`](api/color-capture-color.md#capturecolormodel) | Type |
| [`CaptureColorTransformInput`](api/color-capture-color.md#capturecolortransforminput) | Type |
| [`CaptureColorTransformResult`](api/color-capture-color.md#capturecolortransformresult) | Type |
| [`CaptureColorWhiteBalance`](api/color-capture-color.md#capturecolorwhitebalance) | Type |
| [`LINEAR_CAPTURE_RGB_PROFILE`](api/color-capture-color.md#linear_capture_rgb_profile) | Runtime |
| [`parseCaptureColorTransformInput`](api/color-capture-color.md#parsecapturecolortransforminput) | Runtime |
| [`resolveCaptureColorModel`](api/color-capture-color.md#resolvecapturecolormodel) | Runtime |
| [`VIRTUAL_COLOR_CAMERA_PROFILE`](api/color-capture-color.md#virtual_color_camera_profile) | Runtime |

## color/chromatic-adaptation.ts

[Detailed contracts](api/color-chromatic-adaptation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/chromatic-adaptation.ts)

| Export | Kind |
| --- | --- |
| [`calculateChromaticAdaptationMatrix`](api/color-chromatic-adaptation.md#calculatechromaticadaptationmatrix) | Runtime |
| [`CalculateChromaticAdaptationMatrixInput`](api/color-chromatic-adaptation.md#calculatechromaticadaptationmatrixinput) | Type |
| [`calculateChromaticallyAdaptedXyz`](api/color-chromatic-adaptation.md#calculatechromaticallyadaptedxyz) | Runtime |
| [`CHROMATIC_ADAPTATION_TRANSFORMS`](api/color-chromatic-adaptation.md#chromatic_adaptation_transforms) | Runtime |
| [`ChromaticAdaptationMatrix`](api/color-chromatic-adaptation.md#chromaticadaptationmatrix) | Type |
| [`ChromaticAdaptationTransform`](api/color-chromatic-adaptation.md#chromaticadaptationtransform) | Type |
| [`resolveChromaticAdaptationConeMatrix`](api/color-chromatic-adaptation.md#resolvechromaticadaptationconematrix) | Runtime |

## color/color-difference.ts

[Detailed contracts](api/color-color-difference.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/color-difference.ts)

| Export | Kind |
| --- | --- |
| [`calculateCielabFromCielch`](api/color-color-difference.md#calculatecielabfromcielch) | Runtime |
| [`calculateCielabFromXyz`](api/color-color-difference.md#calculatecielabfromxyz) | Runtime |
| [`calculateCielchFromCielab`](api/color-color-difference.md#calculatecielchfromcielab) | Runtime |
| [`calculateColorDifference`](api/color-color-difference.md#calculatecolordifference) | Runtime |
| [`CalculateColorDifferenceInput`](api/color-color-difference.md#calculatecolordifferenceinput) | Type |
| [`calculateXyzFromCielab`](api/color-color-difference.md#calculatexyzfromcielab) | Runtime |
| [`Cie94ParametricFactors`](api/color-color-difference.md#cie94parametricfactors) | Type |
| [`Ciede2000ParametricFactors`](api/color-color-difference.md#ciede2000parametricfactors) | Type |
| [`CielabColor`](api/color-color-difference.md#cielabcolor) | Type |
| [`CielchColor`](api/color-color-difference.md#cielchcolor) | Type |
| [`ColorDifferenceFormula`](api/color-color-difference.md#colordifferenceformula) | Type |

## color/color-matching-functions.ts

[Detailed contracts](api/color-color-matching-functions.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/color-matching-functions.ts)

| Export | Kind |
| --- | --- |
| [`ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS`](api/color-color-matching-functions.md#analytic_cie_1931_cmf_domain_nanometers) | Runtime |
| [`ColorimetricObserver`](api/color-color-matching-functions.md#colorimetricobserver) | Type |
| [`ColorimetricQuadratureNode`](api/color-color-matching-functions.md#colorimetricquadraturenode) | Type |
| [`ColorimetricSpectralSample`](api/color-color-matching-functions.md#colorimetricspectralsample) | Type |
| [`ColorimetricSpectrum`](api/color-color-matching-functions.md#colorimetricspectrum) | Type |
| [`COLORIMETRY_MODEL_VERSION`](api/color-color-matching-functions.md#colorimetry_model_version) | Runtime |
| [`ColorMatchingFunctionsSource`](api/color-color-matching-functions.md#colormatchingfunctionssource) | Type |
| [`createColorimetricMidpointQuadrature`](api/color-color-matching-functions.md#createcolorimetricmidpointquadrature) | Runtime |
| [`CreateColorimetricMidpointQuadratureInput`](api/color-color-matching-functions.md#createcolorimetricmidpointquadratureinput) | Type |
| [`estimateCie1931ColorMatchingFunctions`](api/color-color-matching-functions.md#estimatecie1931colormatchingfunctions) | Runtime |
| [`IntegratedSpectrumXyz`](api/color-color-matching-functions.md#integratedspectrumxyz) | Type |
| [`integrateSpectrumToXyz`](api/color-color-matching-functions.md#integratespectrumtoxyz) | Runtime |
| [`IntegrateSpectrumToXyzInput`](api/color-color-matching-functions.md#integratespectrumtoxyzinput) | Type |
| [`MAX_COLORIMETRIC_QUADRATURE_NODES`](api/color-color-matching-functions.md#max_colorimetric_quadrature_nodes) | Runtime |
| [`MAX_COLORIMETRIC_TABLE_SAMPLES`](api/color-color-matching-functions.md#max_colorimetric_table_samples) | Runtime |
| [`parseColorimetricQuadratureNodes`](api/color-color-matching-functions.md#parsecolorimetricquadraturenodes) | Runtime |
| [`prepareColorimetricSpectrum`](api/color-color-matching-functions.md#preparecolorimetricspectrum) | Runtime |
| [`prepareColorMatchingFunctions`](api/color-color-matching-functions.md#preparecolormatchingfunctions) | Runtime |
| [`PreparedColorimetricSpectrum`](api/color-color-matching-functions.md#preparedcolorimetricspectrum) | Type |
| [`PreparedColorMatchingFunctions`](api/color-color-matching-functions.md#preparedcolormatchingfunctions) | Type |
| [`TabulatedColorMatchingSample`](api/color-color-matching-functions.md#tabulatedcolormatchingsample) | Type |
| [`TristimulusNormalization`](api/color-color-matching-functions.md#tristimulusnormalization) | Type |

## color/colorimetry-math.ts

[Detailed contracts](api/color-colorimetry-math.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/colorimetry-math.ts)

| Export | Kind |
| --- | --- |
| [`Cie1960UvChromaticity`](api/color-colorimetry-math.md#cie1960uvchromaticity) | Type |
| [`CieXyChromaticity`](api/color-colorimetry-math.md#ciexychromaticity) | Type |
| [`CieXyzTristimulus`](api/color-colorimetry-math.md#ciexyztristimulus) | Type |
| [`ColorMatrix3x3`](api/color-colorimetry-math.md#colormatrix3x3) | Type |
| [`ColorVector3`](api/color-colorimetry-math.md#colorvector3) | Type |

## color/gamut-mapping.ts

[Detailed contracts](api/color-gamut-mapping.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/gamut-mapping.ts)

| Export | Kind |
| --- | --- |
| [`calculateGamutMappedColor`](api/color-gamut-mapping.md#calculategamutmappedcolor) | Runtime |
| [`GamutMappedColor`](api/color-gamut-mapping.md#gamutmappedcolor) | Type |
| [`GamutMappingMethod`](api/color-gamut-mapping.md#gamutmappingmethod) | Type |
| [`PreparedRgbGamutMapping`](api/color-gamut-mapping.md#preparedrgbgamutmapping) | Type |
| [`prepareRgbGamutMapping`](api/color-gamut-mapping.md#preparergbgamutmapping) | Runtime |
| [`PrepareRgbGamutMappingInput`](api/color-gamut-mapping.md#preparergbgamutmappinginput) | Type |

## color/illuminants.ts

[Detailed contracts](api/color-illuminants.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/illuminants.ts)

| Export | Kind |
| --- | --- |
| [`BOLTZMANN_CONSTANT_JOULES_PER_KELVIN`](api/color-illuminants.md#boltzmann_constant_joules_per_kelvin) | Runtime |
| [`calculateChromaticityFromCorrelatedColorTemperature`](api/color-illuminants.md#calculatechromaticityfromcorrelatedcolortemperature) | Runtime |
| [`calculateCieDaylightComponentWeights`](api/color-illuminants.md#calculateciedaylightcomponentweights) | Runtime |
| [`calculateCieIlluminantARelativeSpectralPower`](api/color-illuminants.md#calculatecieilluminantarelativespectralpower) | Runtime |
| [`calculateCorrelatedColorTemperature`](api/color-illuminants.md#calculatecorrelatedcolortemperature) | Runtime |
| [`calculatePlanckianChromaticity`](api/color-illuminants.md#calculateplanckianchromaticity) | Runtime |
| [`calculatePlanckianSpectralRadiance`](api/color-illuminants.md#calculateplanckianspectralradiance) | Runtime |
| [`CIE_DAYLIGHT_LOCUS_RANGE_KELVIN`](api/color-illuminants.md#cie_daylight_locus_range_kelvin) | Runtime |
| [`CIE_ILLUMINANT_A_RANGE_NANOMETERS`](api/color-illuminants.md#cie_illuminant_a_range_nanometers) | Runtime |
| [`CieDaylightBasis`](api/color-illuminants.md#ciedaylightbasis) | Type |
| [`CieDaylightComponentWeights`](api/color-illuminants.md#ciedaylightcomponentweights) | Type |
| [`CorrelatedColorTemperatureResult`](api/color-illuminants.md#correlatedcolortemperatureresult) | Type |
| [`createCieDaylightSpectrum`](api/color-illuminants.md#createciedaylightspectrum) | Runtime |
| [`createCieIlluminantASpectrum`](api/color-illuminants.md#createcieilluminantaspectrum) | Runtime |
| [`createPlanckianSpectrum`](api/color-illuminants.md#createplanckianspectrum) | Runtime |
| [`estimateCorrelatedColorTemperatureMcCamy`](api/color-illuminants.md#estimatecorrelatedcolortemperaturemccamy) | Runtime |
| [`estimatePlanckianLocusChromaticity`](api/color-illuminants.md#estimateplanckianlocuschromaticity) | Runtime |
| [`MAX_CORRELATED_COLOR_TEMPERATURE_DUV`](api/color-illuminants.md#max_correlated_color_temperature_duv) | Runtime |
| [`PLANCK_CONSTANT_JOULE_SECONDS`](api/color-illuminants.md#planck_constant_joule_seconds) | Runtime |
| [`PLANCKIAN_LOCUS_RANGE_KELVIN`](api/color-illuminants.md#planckian_locus_range_kelvin) | Runtime |
| [`PlanckianLocusModel`](api/color-illuminants.md#planckianlocusmodel) | Type |
| [`SECOND_RADIATION_CONSTANT_METER_KELVIN`](api/color-illuminants.md#second_radiation_constant_meter_kelvin) | Runtime |
| [`SPEED_OF_LIGHT_METERS_PER_SECOND`](api/color-illuminants.md#speed_of_light_meters_per_second) | Runtime |
| [`WhiteLocus`](api/color-illuminants.md#whitelocus) | Type |

## color/rgb-color-spaces.ts

[Detailed contracts](api/color-rgb-color-spaces.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/rgb-color-spaces.ts)

| Export | Kind |
| --- | --- |
| [`Bt1886Eotf`](api/color-rgb-color-spaces.md#bt1886eotf) | Type |
| [`calculateRgbToXyzMatrices`](api/color-rgb-color-spaces.md#calculatergbtoxyzmatrices) | Runtime |
| [`evaluateBt709InverseOetf`](api/color-rgb-color-spaces.md#evaluatebt709inverseoetf) | Runtime |
| [`evaluateBt709Oetf`](api/color-rgb-color-spaces.md#evaluatebt709oetf) | Runtime |
| [`evaluateSrgbDecoding`](api/color-rgb-color-spaces.md#evaluatesrgbdecoding) | Runtime |
| [`evaluateSrgbEncoding`](api/color-rgb-color-spaces.md#evaluatesrgbencoding) | Runtime |
| [`prepareBt1886Eotf`](api/color-rgb-color-spaces.md#preparebt1886eotf) | Runtime |
| [`resolveRgbColorSpace`](api/color-rgb-color-spaces.md#resolvergbcolorspace) | Runtime |
| [`RgbColorSpaceDefinition`](api/color-rgb-color-spaces.md#rgbcolorspacedefinition) | Type |
| [`RgbColorSpaceId`](api/color-rgb-color-spaces.md#rgbcolorspaceid) | Type |
| [`RgbPrimaryChromaticities`](api/color-rgb-color-spaces.md#rgbprimarychromaticities) | Type |
| [`RgbToXyzMatrices`](api/color-rgb-color-spaces.md#rgbtoxyzmatrices) | Type |
| [`RgbTransferFunctionId`](api/color-rgb-color-spaces.md#rgbtransferfunctionid) | Type |

## color/sensor-color-development.ts

[Detailed contracts](api/color-sensor-color-development.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/sensor-color-development.ts)

| Export | Kind |
| --- | --- |
| [`RAW_HIGHLIGHT_RECONSTRUCTION_START`](api/color-sensor-color-development.md#raw_highlight_reconstruction_start) | Runtime |
| [`RawHighlightMode`](api/color-sensor-color-development.md#rawhighlightmode) | Type |
| [`SENSOR_COLOR_DEVELOPMENT_MODEL`](api/color-sensor-color-development.md#sensor_color_development_model) | Runtime |

## color/srgb-icc.ts

[Detailed contracts](api/color-srgb-icc.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/srgb-icc.ts)

| Export | Kind |
| --- | --- |
| [`createSrgbIccProfile`](api/color-srgb-icc.md#createsrgbiccprofile) | Runtime |
| [`SRGB_ICC_PROFILE_VERSION`](api/color-srgb-icc.md#srgb_icc_profile_version) | Runtime |

## color/white-balance.ts

[Detailed contracts](api/color-white-balance.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/color/white-balance.ts)

| Export | Kind |
| --- | --- |
| [`COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION`](api/color-white-balance.md#color_temperature_white_balance_intent_version) | Runtime |
| [`ColorTemperatureWhiteBalanceCameraModel`](api/color-white-balance.md#colortemperaturewhitebalancecameramodel) | Type |
| [`ColorTemperatureWhiteBalanceIntent`](api/color-white-balance.md#colortemperaturewhitebalanceintent) | Type |
| [`createColorTemperatureWhiteBalanceIntent`](api/color-white-balance.md#createcolortemperaturewhitebalanceintent) | Runtime |
| [`CreateColorTemperatureWhiteBalanceIntentInput`](api/color-white-balance.md#createcolortemperaturewhitebalanceintentinput) | Type |
| [`createLockedWhiteBalanceState`](api/color-white-balance.md#createlockedwhitebalancestate) | Runtime |
| [`CreateLockedWhiteBalanceStateInput`](api/color-white-balance.md#createlockedwhitebalancestateinput) | Type |
| [`estimateAutoWhiteBalance`](api/color-white-balance.md#estimateautowhitebalance) | Runtime |
| [`EstimateAutoWhiteBalanceInput`](api/color-white-balance.md#estimateautowhitebalanceinput) | Type |
| [`parseResolvedWhiteBalanceState`](api/color-white-balance.md#parseresolvedwhitebalancestate) | Runtime |
| [`parseWhiteBalanceProfile`](api/color-white-balance.md#parsewhitebalanceprofile) | Runtime |
| [`PreWhiteBalanceRgbSample`](api/color-white-balance.md#prewhitebalancergbsample) | Type |
| [`PreWhiteBalanceRgbSampleSet`](api/color-white-balance.md#prewhitebalancergbsampleset) | Type |
| [`resolveColorTemperatureWhiteBalance`](api/color-white-balance.md#resolvecolortemperaturewhitebalance) | Runtime |
| [`ResolveColorTemperatureWhiteBalanceInput`](api/color-white-balance.md#resolvecolortemperaturewhitebalanceinput) | Type |
| [`resolveCustomWhiteBalance`](api/color-white-balance.md#resolvecustomwhitebalance) | Runtime |
| [`ResolveCustomWhiteBalanceInput`](api/color-white-balance.md#resolvecustomwhitebalanceinput) | Type |
| [`ResolvedColorTemperatureWhiteBalance`](api/color-white-balance.md#resolvedcolortemperaturewhitebalance) | Type |
| [`ResolvedWhiteBalanceState`](api/color-white-balance.md#resolvedwhitebalancestate) | Type |
| [`resolveManualWhiteBalance`](api/color-white-balance.md#resolvemanualwhitebalance) | Runtime |
| [`ResolveManualWhiteBalanceInput`](api/color-white-balance.md#resolvemanualwhitebalanceinput) | Type |
| [`resolvePresetWhiteBalance`](api/color-white-balance.md#resolvepresetwhitebalance) | Runtime |
| [`ResolvePresetWhiteBalanceInput`](api/color-white-balance.md#resolvepresetwhitebalanceinput) | Type |
| [`WHITE_BALANCE_PROFILE_SCHEMA_VERSION`](api/color-white-balance.md#white_balance_profile_schema_version) | Runtime |
| [`WHITE_BALANCE_STATE_VERSION`](api/color-white-balance.md#white_balance_state_version) | Runtime |
| [`WhiteBalanceAwbIntent`](api/color-white-balance.md#whitebalanceawbintent) | Type |
| [`WhiteBalanceAwbPolicy`](api/color-white-balance.md#whitebalanceawbpolicy) | Type |
| [`WhiteBalanceChannelGains`](api/color-white-balance.md#whitebalancechannelgains) | Type |
| [`WhiteBalanceInputDomain`](api/color-white-balance.md#whitebalanceinputdomain) | Type |
| [`WhiteBalancePresetDefinition`](api/color-white-balance.md#whitebalancepresetdefinition) | Type |
| [`WhiteBalanceProfile`](api/color-white-balance.md#whitebalanceprofile) | Type |

## composition/image-formation-plan.ts

[Detailed contracts](api/composition-image-formation-plan.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/composition/image-formation-plan.ts)

| Export | Kind |
| --- | --- |
| [`createProductionCaptureSnapshot`](api/composition-image-formation-plan.md#createproductioncapturesnapshot) | Runtime |
| [`createProductionCaptureSnapshotFromReleaseFrame`](api/composition-image-formation-plan.md#createproductioncapturesnapshotfromreleaseframe) | Runtime |
| [`CreateProductionCaptureSnapshotFromReleaseFrameInput`](api/composition-image-formation-plan.md#createproductioncapturesnapshotfromreleaseframeinput) | Type |
| [`CreateProductionCaptureSnapshotInput`](api/composition-image-formation-plan.md#createproductioncapturesnapshotinput) | Type |
| [`createProductionImageFormationPlan`](api/composition-image-formation-plan.md#createproductionimageformationplan) | Runtime |
| [`CreateProductionImageFormationPlanInput`](api/composition-image-formation-plan.md#createproductionimageformationplaninput) | Type |
| [`IMAGE_FORMATION_FIDELITY_PROFILE_SCHEMA_VERSION`](api/composition-image-formation-plan.md#image_formation_fidelity_profile_schema_version) | Runtime |
| [`ImageFormationFidelityProfile`](api/composition-image-formation-plan.md#imageformationfidelityprofile) | Type |
| [`parseImageFormationFidelityProfile`](api/composition-image-formation-plan.md#parseimageformationfidelityprofile) | Runtime |
| [`parsePreparedImageFormationContext`](api/composition-image-formation-plan.md#parsepreparedimageformationcontext) | Runtime |
| [`parseProductionCaptureSnapshot`](api/composition-image-formation-plan.md#parseproductioncapturesnapshot) | Runtime |
| [`parseRendererCapabilityDeclaration`](api/composition-image-formation-plan.md#parserenderercapabilitydeclaration) | Runtime |
| [`PlannedImageFormationEffect`](api/composition-image-formation-plan.md#plannedimageformationeffect) | Type |
| [`PlannedImageFormationEffectState`](api/composition-image-formation-plan.md#plannedimageformationeffectstate) | Type |
| [`PlannedImageFormationStage`](api/composition-image-formation-plan.md#plannedimageformationstage) | Type |
| [`PlannedImageFormationStageState`](api/composition-image-formation-plan.md#plannedimageformationstagestate) | Type |
| [`PlannedScientificStatus`](api/composition-image-formation-plan.md#plannedscientificstatus) | Type |
| [`PREPARED_IMAGE_FORMATION_CONTEXT_VERSION`](api/composition-image-formation-plan.md#prepared_image_formation_context_version) | Runtime |
| [`PreparedImageFormationContext`](api/composition-image-formation-plan.md#preparedimageformationcontext) | Type |
| [`prepareImageFormationContext`](api/composition-image-formation-plan.md#prepareimageformationcontext) | Runtime |
| [`PrepareImageFormationContextInput`](api/composition-image-formation-plan.md#prepareimageformationcontextinput) | Type |
| [`PRODUCTION_CAPTURE_SNAPSHOT_VERSION`](api/composition-image-formation-plan.md#production_capture_snapshot_version) | Runtime |
| [`PRODUCTION_IMAGE_FORMATION_PLAN_VERSION`](api/composition-image-formation-plan.md#production_image_formation_plan_version) | Runtime |
| [`ProductionCaptureSnapshot`](api/composition-image-formation-plan.md#productioncapturesnapshot) | Type |
| [`ProductionEnvironmentCaptureInput`](api/composition-image-formation-plan.md#productionenvironmentcaptureinput) | Type |
| [`ProductionImageFormationBlocker`](api/composition-image-formation-plan.md#productionimageformationblocker) | Type |
| [`ProductionImageFormationBlockerCode`](api/composition-image-formation-plan.md#productionimageformationblockercode) | Type |
| [`ProductionImageFormationPlan`](api/composition-image-formation-plan.md#productionimageformationplan) | Type |
| [`ProductionPhysicalSceneSample`](api/composition-image-formation-plan.md#productionphysicalscenesample) | Type |
| [`ProductionProcessedOutputInput`](api/composition-image-formation-plan.md#productionprocessedoutputinput) | Type |
| [`ProductionReleaseFrameBinding`](api/composition-image-formation-plan.md#productionreleaseframebinding) | Type |
| [`ProductionTemporalCaptureInput`](api/composition-image-formation-plan.md#productiontemporalcaptureinput) | Type |
| [`ProductionTemporalCaptureResult`](api/composition-image-formation-plan.md#productiontemporalcaptureresult) | Type |
| [`RENDERER_CAPABILITY_SCHEMA_VERSION`](api/composition-image-formation-plan.md#renderer_capability_schema_version) | Runtime |
| [`RendererCapabilityDeclaration`](api/composition-image-formation-plan.md#renderercapabilitydeclaration) | Type |
| [`RendererConsumerKind`](api/composition-image-formation-plan.md#rendererconsumerkind) | Type |
| [`RequiredImageFormationEffect`](api/composition-image-formation-plan.md#requiredimageformationeffect) | Type |
| [`serializeProductionImageFormationPlan`](api/composition-image-formation-plan.md#serializeproductionimageformationplan) | Runtime |

## composition/plan-consumer.ts

[Detailed contracts](api/composition-plan-consumer.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/composition/plan-consumer.ts)

| Export | Kind |
| --- | --- |
| [`createProductionPlanConsumerManifest`](api/composition-plan-consumer.md#createproductionplanconsumermanifest) | Runtime |
| [`CreateProductionPlanConsumerManifestInput`](api/composition-plan-consumer.md#createproductionplanconsumermanifestinput) | Type |
| [`PRODUCTION_PLAN_CONSUMER_MANIFEST_VERSION`](api/composition-plan-consumer.md#production_plan_consumer_manifest_version) | Runtime |
| [`ProductionPlanConsumerManifest`](api/composition-plan-consumer.md#productionplanconsumermanifest) | Type |

## core/calculation-result.ts

[Detailed contracts](api/core-calculation-result.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/calculation-result.ts)

| Export | Kind |
| --- | --- |
| [`AbsoluteUncertaintyEstimate`](api/core-calculation-result.md#absoluteuncertaintyestimate) | Type |
| [`approximationResult`](api/core-calculation-result.md#approximationresult) | Runtime |
| [`calculatedResult`](api/core-calculation-result.md#calculatedresult) | Runtime |
| [`CalculationProvenance`](api/core-calculation-result.md#calculationprovenance) | Type |
| [`CalculationQuality`](api/core-calculation-result.md#calculationquality) | Type |
| [`CalculationResult`](api/core-calculation-result.md#calculationresult) | Type |
| [`CalculationValidRange`](api/core-calculation-result.md#calculationvalidrange) | Type |
| [`calibratedResult`](api/core-calculation-result.md#calibratedresult) | Runtime |
| [`estimatedResult`](api/core-calculation-result.md#estimatedresult) | Runtime |
| [`ProvenanceKind`](api/core-calculation-result.md#provenancekind) | Type |
| [`RelativeUncertaintyEstimate`](api/core-calculation-result.md#relativeuncertaintyestimate) | Type |
| [`UncertaintyConfidence`](api/core-calculation-result.md#uncertaintyconfidence) | Type |
| [`UncertaintyEstimate`](api/core-calculation-result.md#uncertaintyestimate) | Type |
| [`UncertaintySource`](api/core-calculation-result.md#uncertaintysource) | Type |
| [`validateCalculationQuality`](api/core-calculation-result.md#validatecalculationquality) | Runtime |

## core/configuration-error.ts

[Detailed contracts](api/core-configuration-error.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/configuration-error.ts)

| Export | Kind |
| --- | --- |
| [`InvalidConfigurationError`](api/core-configuration-error.md#invalidconfigurationerror) | Runtime |

## core/image-formation.ts

[Detailed contracts](api/core-image-formation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/image-formation.ts)

| Export | Kind |
| --- | --- |
| [`getImageFormationContract`](api/core-image-formation.md#getimageformationcontract) | Runtime |
| [`IMAGE_FORMATION_CONTRACT_VERSION`](api/core-image-formation.md#image_formation_contract_version) | Runtime |
| [`ImageFormationContract`](api/core-image-formation.md#imageformationcontract) | Type |
| [`ImageFormationCoordinateSpaceContract`](api/core-image-formation.md#imageformationcoordinatespacecontract) | Type |
| [`ImageFormationCoordinateSpaceId`](api/core-image-formation.md#imageformationcoordinatespaceid) | Type |
| [`ImageFormationDomainId`](api/core-image-formation.md#imageformationdomainid) | Type |
| [`ImageFormationEffectId`](api/core-image-formation.md#imageformationeffectid) | Type |
| [`ImageFormationEffectPlacement`](api/core-image-formation.md#imageformationeffectplacement) | Type |
| [`ImageFormationImplementationStatus`](api/core-image-formation.md#imageformationimplementationstatus) | Type |
| [`ImageFormationRendererContract`](api/core-image-formation.md#imageformationrenderercontract) | Type |
| [`ImageFormationStageContract`](api/core-image-formation.md#imageformationstagecontract) | Type |
| [`ImageFormationStageId`](api/core-image-formation.md#imageformationstageid) | Type |
| [`ImageFormationTemporalContract`](api/core-image-formation.md#imageformationtemporalcontract) | Type |

## core/pixel-limits.ts

[Detailed contracts](api/core-pixel-limits.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/pixel-limits.ts)

| Export | Kind |
| --- | --- |
| [`FULL_RESOLUTION_CEILING_PIXELS`](api/core-pixel-limits.md#full_resolution_ceiling_pixels) | Runtime |
| [`FULL_RESOLUTION_DEFAULT_PIXELS`](api/core-pixel-limits.md#full_resolution_default_pixels) | Runtime |

## core/scientific-assurance.ts

[Detailed contracts](api/core-scientific-assurance.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/scientific-assurance.ts)

| Export | Kind |
| --- | --- |
| [`ComposedScientificAssurance`](api/core-scientific-assurance.md#composedscientificassurance) | Type |
| [`ComposedScientificUncertaintyStatus`](api/core-scientific-assurance.md#composedscientificuncertaintystatus) | Type |
| [`composeScientificAssurance`](api/core-scientific-assurance.md#composescientificassurance) | Runtime |
| [`ComposeScientificAssuranceInput`](api/core-scientific-assurance.md#composescientificassuranceinput) | Type |
| [`SCIENTIFIC_ASSURANCE_CONTRACT_VERSION`](api/core-scientific-assurance.md#scientific_assurance_contract_version) | Runtime |
| [`ScientificAssuranceBasisKind`](api/core-scientific-assurance.md#scientificassurancebasiskind) | Type |
| [`ScientificAssuranceComponent`](api/core-scientific-assurance.md#scientificassurancecomponent) | Type |
| [`ScientificAssuranceComponentUncertainty`](api/core-scientific-assurance.md#scientificassurancecomponentuncertainty) | Type |
| [`ScientificAssuranceSourceIdentity`](api/core-scientific-assurance.md#scientificassurancesourceidentity) | Type |
| [`ScientificAssuranceSourceKind`](api/core-scientific-assurance.md#scientificassurancesourcekind) | Type |
| [`ScientificAssuranceStatus`](api/core-scientific-assurance.md#scientificassurancestatus) | Type |

## core/spectral-composition.ts

[Detailed contracts](api/core-spectral-composition.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/spectral-composition.ts)

| Export | Kind |
| --- | --- |
| [`composeSpectralCoverage`](api/core-spectral-composition.md#composespectralcoverage) | Runtime |
| [`ComposeSpectralCoverageInput`](api/core-spectral-composition.md#composespectralcoverageinput) | Type |
| [`DiscreteSpectralLineMeasure`](api/core-spectral-composition.md#discretespectrallinemeasure) | Type |
| [`DiscreteSpectralLineMeasureEntry`](api/core-spectral-composition.md#discretespectrallinemeasureentry) | Type |
| [`DiscreteSpectralLineQuantityUnit`](api/core-spectral-composition.md#discretespectrallinequantityunit) | Type |
| [`DistributeIntegratedQuantityAcrossDiscreteLinesInput`](api/core-spectral-composition.md#distributeintegratedquantityacrossdiscretelinesinput) | Type |
| [`distributeIntegratedQuantityAcrossDiscreteSpectralLines`](api/core-spectral-composition.md#distributeintegratedquantityacrossdiscretespectrallines) | Runtime |
| [`IntegratedDiscreteSpectralLineMeasure`](api/core-spectral-composition.md#integrateddiscretespectrallinemeasure) | Type |
| [`integrateDiscreteSpectralLineMeasure`](api/core-spectral-composition.md#integratediscretespectrallinemeasure) | Runtime |
| [`NormalizedDiscreteSpectralLine`](api/core-spectral-composition.md#normalizeddiscretespectralline) | Type |
| [`NormalizedDiscreteSpectralLineDistribution`](api/core-spectral-composition.md#normalizeddiscretespectrallinedistribution) | Type |
| [`parseNormalizedDiscreteSpectralLineDistribution`](api/core-spectral-composition.md#parsenormalizeddiscretespectrallinedistribution) | Runtime |
| [`parseSpectralCoverageParticipant`](api/core-spectral-composition.md#parsespectralcoverageparticipant) | Runtime |
| [`ResolvedSpectralWavelengthBasis`](api/core-spectral-composition.md#resolvedspectralwavelengthbasis) | Type |
| [`SpectralCoverageComposition`](api/core-spectral-composition.md#spectralcoveragecomposition) | Type |
| [`SpectralCoverageParticipant`](api/core-spectral-composition.md#spectralcoverageparticipant) | Type |
| [`SpectralCoverageParticipantRole`](api/core-spectral-composition.md#spectralcoverageparticipantrole) | Type |

## core/spectral.ts

[Detailed contracts](api/core-spectral.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/spectral.ts)

| Export | Kind |
| --- | --- |
| [`parseSpectralWavelengthBasis`](api/core-spectral.md#parsespectralwavelengthbasis) | Runtime |
| [`parseSpectralWavelengthRangeNanometers`](api/core-spectral.md#parsespectralwavelengthrangenanometers) | Runtime |
| [`parseSpectralWavelengthSample`](api/core-spectral.md#parsespectralwavelengthsample) | Runtime |
| [`SpectralWavelengthBasis`](api/core-spectral.md#spectralwavelengthbasis) | Type |
| [`SpectralWavelengthRangeNanometers`](api/core-spectral.md#spectralwavelengthrangenanometers) | Type |
| [`SpectralWavelengthSample`](api/core-spectral.md#spectralwavelengthsample) | Type |

## core/validation.ts

[Detailed contracts](api/core-validation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/validation.ts)

| Export | Kind |
| --- | --- |
| [`InvalidScientificInputError`](api/core-validation.md#invalidscientificinputerror) | Runtime |
| [`InvalidScientificResultError`](api/core-validation.md#invalidscientificresulterror) | Runtime |

## core/version.ts

[Detailed contracts](api/core-version.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/core/version.ts)

| Export | Kind |
| --- | --- |
| [`ENGINE_API_VERSION`](api/core-version.md#engine_api_version) | Runtime |

## equipment/exposure-capabilities.ts

[Detailed contracts](api/equipment-exposure-capabilities.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/exposure-capabilities.ts)

| Export | Kind |
| --- | --- |
| [`FocalLengthFNumberSample`](api/equipment-exposure-capabilities.md#focallengthfnumbersample) | Type |
| [`GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION`](api/equipment-exposure-capabilities.md#generic_equipment_exposure_capability_schema_version) | Runtime |
| [`GenericBodyExposureCapabilityProfile`](api/equipment-exposure-capabilities.md#genericbodyexposurecapabilityprofile) | Type |
| [`GenericCapabilityAvailability`](api/equipment-exposure-capabilities.md#genericcapabilityavailability) | Type |
| [`GenericLensExposureCapabilityProfile`](api/equipment-exposure-capabilities.md#genericlensexposurecapabilityprofile) | Type |
| [`NumericCapabilityRange`](api/equipment-exposure-capabilities.md#numericcapabilityrange) | Type |
| [`NumericSettingGrid`](api/equipment-exposure-capabilities.md#numericsettinggrid) | Type |
| [`parseGenericBodyExposureCapabilityProfile`](api/equipment-exposure-capabilities.md#parsegenericbodyexposurecapabilityprofile) | Runtime |
| [`parseGenericLensExposureCapabilityProfile`](api/equipment-exposure-capabilities.md#parsegenericlensexposurecapabilityprofile) | Runtime |
| [`ResolvedGenericEquipmentExposureCapabilities`](api/equipment-exposure-capabilities.md#resolvedgenericequipmentexposurecapabilities) | Type |
| [`ResolvedNumericSettingGrid`](api/equipment-exposure-capabilities.md#resolvednumericsettinggrid) | Type |
| [`resolveGenericEquipmentExposureCapabilities`](api/equipment-exposure-capabilities.md#resolvegenericequipmentexposurecapabilities) | Runtime |
| [`ResolveGenericEquipmentExposureCapabilitiesInput`](api/equipment-exposure-capabilities.md#resolvegenericequipmentexposurecapabilitiesinput) | Type |
| [`WidestAvailableFNumberCapability`](api/equipment-exposure-capabilities.md#widestavailablefnumbercapability) | Type |

## equipment/generic-lens-catalogue.ts

[Detailed contracts](api/equipment-generic-lens-catalogue.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/generic-lens-catalogue.ts)

| Export | Kind |
| --- | --- |
| [`GENERIC_LENS_CATALOGUE`](api/equipment-generic-lens-catalogue.md#generic_lens_catalogue) | Runtime |
| [`GENERIC_LENS_IDS`](api/equipment-generic-lens-catalogue.md#generic_lens_ids) | Runtime |
| [`GENERIC_LENS_SET_BASELINES`](api/equipment-generic-lens-catalogue.md#generic_lens_set_baselines) | Runtime |
| [`GenericLensAdjustments`](api/equipment-generic-lens-catalogue.md#genericlensadjustments) | Type |
| [`GenericLensCatalogueEntry`](api/equipment-generic-lens-catalogue.md#genericlenscatalogueentry) | Type |
| [`GenericLensCharacter`](api/equipment-generic-lens-catalogue.md#genericlenscharacter) | Type |
| [`GenericLensCharacterValues`](api/equipment-generic-lens-catalogue.md#genericlenscharactervalues) | Type |
| [`GenericLensFocusError`](api/equipment-generic-lens-catalogue.md#genericlensfocuserror) | Type |
| [`GenericLensKind`](api/equipment-generic-lens-catalogue.md#genericlenskind) | Type |
| [`GenericLensSet`](api/equipment-generic-lens-catalogue.md#genericlensset) | Type |
| [`ResolvedGenericLens`](api/equipment-generic-lens-catalogue.md#resolvedgenericlens) | Type |
| [`resolveGenericLens`](api/equipment-generic-lens-catalogue.md#resolvegenericlens) | Runtime |
| [`ResolveGenericLensInput`](api/equipment-generic-lens-catalogue.md#resolvegenericlensinput) | Type |
| [`simulateGenericLensFocusError`](api/equipment-generic-lens-catalogue.md#simulategenericlensfocuserror) | Runtime |
| [`SimulateGenericLensFocusErrorInput`](api/equipment-generic-lens-catalogue.md#simulategenericlensfocuserrorinput) | Type |

## equipment/generic-prime-lenses.ts

[Detailed contracts](api/equipment-generic-prime-lenses.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/generic-prime-lenses.ts)

| Export | Kind |
| --- | --- |
| [`calculateGenericPrimeMinimumFocusDistanceM`](api/equipment-generic-prime-lenses.md#calculategenericprimeminimumfocusdistancem) | Runtime |
| [`GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM`](api/equipment-generic-prime-lenses.md#generic_prime_equivalent_focal_lengths_mm) | Runtime |
| [`GENERIC_PRIME_MINIMUM_FOCUS`](api/equipment-generic-prime-lenses.md#generic_prime_minimum_focus) | Runtime |
| [`GENERIC_PRIME_THIRD_STOP_F_NUMBERS`](api/equipment-generic-prime-lenses.md#generic_prime_third_stop_f_numbers) | Runtime |
| [`GenericPrimeEquivalentFocalLengthMm`](api/equipment-generic-prime-lenses.md#genericprimeequivalentfocallengthmm) | Type |
| [`GenericPrimeLens`](api/equipment-generic-prime-lenses.md#genericprimelens) | Type |
| [`resolveGenericPrimeLens`](api/equipment-generic-prime-lenses.md#resolvegenericprimelens) | Runtime |

## equipment/generic-tier-assets.ts

[Detailed contracts](api/equipment-generic-tier-assets.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/generic-tier-assets.ts)

| Export | Kind |
| --- | --- |
| [`GENERIC_THIRD_STOP_ISO_SETTINGS`](api/equipment-generic-tier-assets.md#generic_third_stop_iso_settings) | Runtime |
| [`GENERIC_THIRD_STOP_SHUTTER_SECONDS`](api/equipment-generic-tier-assets.md#generic_third_stop_shutter_seconds) | Runtime |
| [`GENERIC_WHOLE_STOP_ISO_SETTINGS`](api/equipment-generic-tier-assets.md#generic_whole_stop_iso_settings) | Runtime |
| [`GenericEquipmentTier`](api/equipment-generic-tier-assets.md#genericequipmenttier) | Type |
| [`GenericEquipmentTierPreset`](api/equipment-generic-tier-assets.md#genericequipmenttierpreset) | Type |
| [`GenericTierBodyAssets`](api/equipment-generic-tier-assets.md#generictierbodyassets) | Type |
| [`GenericTierLensAssets`](api/equipment-generic-tier-assets.md#generictierlensassets) | Type |
| [`GenericTierPresetVersion`](api/equipment-generic-tier-assets.md#generictierpresetversion) | Type |
| [`GenericVersionedAsset`](api/equipment-generic-tier-assets.md#genericversionedasset) | Type |

## equipment/generic-tier-presets.ts

[Detailed contracts](api/equipment-generic-tier-presets.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/generic-tier-presets.ts)

| Export | Kind |
| --- | --- |
| [`createGenericEquipmentTierSelection`](api/equipment-generic-tier-presets.md#creategenericequipmenttierselection) | Runtime |
| [`GENERIC_EQUIPMENT_TIER_PRESET_VERSION`](api/equipment-generic-tier-presets.md#generic_equipment_tier_preset_version) | Runtime |
| [`GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS`](api/equipment-generic-tier-presets.md#generic_equipment_tier_preset_versions) | Runtime |
| [`GENERIC_EQUIPMENT_TIERS`](api/equipment-generic-tier-presets.md#generic_equipment_tiers) | Runtime |
| [`GenericEquipmentTierProfileReference`](api/equipment-generic-tier-presets.md#genericequipmenttierprofilereference) | Type |
| [`GenericEquipmentTierSelection`](api/equipment-generic-tier-presets.md#genericequipmenttierselection) | Type |
| [`parseGenericEquipmentTierSelection`](api/equipment-generic-tier-presets.md#parsegenericequipmenttierselection) | Runtime |
| [`ResolvedGenericTierLensProfiles`](api/equipment-generic-tier-presets.md#resolvedgenerictierlensprofiles) | Type |
| [`resolveGenericEquipmentTierCatalog`](api/equipment-generic-tier-presets.md#resolvegenericequipmenttiercatalog) | Runtime |
| [`resolveGenericEquipmentTierLensProfiles`](api/equipment-generic-tier-presets.md#resolvegenericequipmenttierlensprofiles) | Runtime |

## equipment/ideal-lens.ts

[Detailed contracts](api/equipment-ideal-lens.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/ideal-lens.ts)

| Export | Kind |
| --- | --- |
| [`IDEAL_LENS_LIMITS`](api/equipment-ideal-lens.md#ideal_lens_limits) | Runtime |

## equipment/iso-capabilities.ts

[Detailed contracts](api/equipment-iso-capabilities.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/iso-capabilities.ts)

| Export | Kind |
| --- | --- |
| [`bindIsoCapabilityToExposureCapabilities`](api/equipment-iso-capabilities.md#bindisocapabilitytoexposurecapabilities) | Runtime |
| [`BindIsoCapabilityToExposureCapabilitiesInput`](api/equipment-iso-capabilities.md#bindisocapabilitytoexposurecapabilitiesinput) | Type |
| [`BoundIsoExposureCapabilities`](api/equipment-iso-capabilities.md#boundisoexposurecapabilities) | Type |
| [`ISO_CAPABILITY_PROFILE_SCHEMA_VERSION`](api/equipment-iso-capabilities.md#iso_capability_profile_schema_version) | Runtime |
| [`IsoAutoIsoCapability`](api/equipment-iso-capabilities.md#isoautoisocapability) | Type |
| [`IsoCapabilityAvailability`](api/equipment-iso-capabilities.md#isocapabilityavailability) | Type |
| [`IsoCapabilityProfile`](api/equipment-iso-capabilities.md#isocapabilityprofile) | Type |
| [`IsoCaptureModePolicy`](api/equipment-iso-capabilities.md#isocapturemodepolicy) | Type |
| [`IsoExpandedSetting`](api/equipment-iso-capabilities.md#isoexpandedsetting) | Type |
| [`IsoExposureIndexRange`](api/equipment-iso-capabilities.md#isoexposureindexrange) | Type |
| [`IsoStandardSettingGrid`](api/equipment-iso-capabilities.md#isostandardsettinggrid) | Type |
| [`parseIsoCapabilityProfile`](api/equipment-iso-capabilities.md#parseisocapabilityprofile) | Runtime |
| [`RequestedIsoSetting`](api/equipment-iso-capabilities.md#requestedisosetting) | Type |
| [`ResolvedIsoCapability`](api/equipment-iso-capabilities.md#resolvedisocapability) | Type |
| [`resolveIsoCapability`](api/equipment-iso-capabilities.md#resolveisocapability) | Runtime |
| [`ResolveIsoCapabilityInput`](api/equipment-iso-capabilities.md#resolveisocapabilityinput) | Type |

## equipment/metering-capabilities.ts

[Detailed contracts](api/equipment-metering-capabilities.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/metering-capabilities.ts)

| Export | Kind |
| --- | --- |
| [`assessExposureMeteringProfileCompatibility`](api/equipment-metering-capabilities.md#assessexposuremeteringprofilecompatibility) | Runtime |
| [`AssessExposureMeteringProfileCompatibilityInput`](api/equipment-metering-capabilities.md#assessexposuremeteringprofilecompatibilityinput) | Type |
| [`GENERIC_BODY_METERING_CAPABILITY_SCHEMA_VERSION`](api/equipment-metering-capabilities.md#generic_body_metering_capability_schema_version) | Runtime |
| [`GenericBodyMeteringCapabilityProfile`](api/equipment-metering-capabilities.md#genericbodymeteringcapabilityprofile) | Type |
| [`GenericSupportedMeteringProfile`](api/equipment-metering-capabilities.md#genericsupportedmeteringprofile) | Type |
| [`MeteringCapabilityCompatibilityAssessment`](api/equipment-metering-capabilities.md#meteringcapabilitycompatibilityassessment) | Type |
| [`MeteringCapabilityCompatibilityBlocker`](api/equipment-metering-capabilities.md#meteringcapabilitycompatibilityblocker) | Type |
| [`parseGenericBodyMeteringCapabilityProfile`](api/equipment-metering-capabilities.md#parsegenericbodymeteringcapabilityprofile) | Runtime |

## equipment/release-capabilities.ts

[Detailed contracts](api/equipment-release-capabilities.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/equipment/release-capabilities.ts)

| Export | Kind |
| --- | --- |
| [`GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION`](api/equipment-release-capabilities.md#generic_release_capability_schema_version) | Runtime |
| [`GenericExposureBracketAxis`](api/equipment-release-capabilities.md#genericexposurebracketaxis) | Type |
| [`GenericReleaseCapabilityProfile`](api/equipment-release-capabilities.md#genericreleasecapabilityprofile) | Type |
| [`GenericReleaseDriveMode`](api/equipment-release-capabilities.md#genericreleasedrivemode) | Type |
| [`parseGenericReleaseCapabilityProfile`](api/equipment-release-capabilities.md#parsegenericreleasecapabilityprofile) | Runtime |

## exposure/auto-iso-slowest-shutter.ts

[Detailed contracts](api/exposure-auto-iso-slowest-shutter.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/auto-iso-slowest-shutter.ts)

| Export | Kind |
| --- | --- |
| [`AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS`](api/exposure-auto-iso-slowest-shutter.md#auto_iso_slowest_shutter_maximum_bias_stops) | Runtime |
| [`AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION`](api/exposure-auto-iso-slowest-shutter.md#auto_iso_slowest_shutter_model_version) | Runtime |
| [`AutoIsoSlowestShutterBlurBudget`](api/exposure-auto-iso-slowest-shutter.md#autoisoslowestshutterblurbudget) | Type |
| [`AutoIsoSlowestShutterEstimate`](api/exposure-auto-iso-slowest-shutter.md#autoisoslowestshutterestimate) | Type |
| [`estimateAutoIsoSlowestShutter`](api/exposure-auto-iso-slowest-shutter.md#estimateautoisoslowestshutter) | Runtime |
| [`EstimateAutoIsoSlowestShutterInput`](api/exposure-auto-iso-slowest-shutter.md#estimateautoisoslowestshutterinput) | Type |
| [`GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`](api/exposure-auto-iso-slowest-shutter.md#generic_handheld_angular_velocity_rad_per_sec) | Runtime |

## exposure/exposure-duration-control.ts

[Detailed contracts](api/exposure-exposure-duration-control.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/exposure-duration-control.ts)

| Export | Kind |
| --- | --- |
| [`bindResolvedExposureDurationToCaptureExposureInput`](api/exposure-exposure-duration-control.md#bindresolvedexposuredurationtocaptureexposureinput) | Runtime |
| [`BindResolvedExposureDurationToCaptureExposureInput`](api/exposure-exposure-duration-control.md#bindresolvedexposuredurationtocaptureexposureinput) | Type |
| [`EXPOSURE_DURATION_CONTROL_VERSION`](api/exposure-exposure-duration-control.md#exposure_duration_control_version) | Runtime |
| [`ExposureDurationControl`](api/exposure-exposure-duration-control.md#exposuredurationcontrol) | Type |
| [`ExposureDurationControlResolution`](api/exposure-exposure-duration-control.md#exposuredurationcontrolresolution) | Type |
| [`resolveExposureDurationControl`](api/exposure-exposure-duration-control.md#resolveexposuredurationcontrol) | Runtime |

## exposure/exposure-mode-resolver.ts

[Detailed contracts](api/exposure-exposure-mode-resolver.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/exposure-mode-resolver.ts)

| Export | Kind |
| --- | --- |
| [`AperturePriorityAutoIsoExposureModeResolution`](api/exposure-exposure-mode-resolver.md#aperturepriorityautoisoexposuremoderesolution) | Type |
| [`AperturePriorityAutoIsoPolicy`](api/exposure-exposure-mode-resolver.md#aperturepriorityautoisopolicy) | Type |
| [`AperturePriorityExposureModeResolution`](api/exposure-exposure-mode-resolver.md#aperturepriorityexposuremoderesolution) | Type |
| [`AutoIsoBaselinePolicy`](api/exposure-exposure-mode-resolver.md#autoisobaselinepolicy) | Type |
| [`AutoIsoLimits`](api/exposure-exposure-mode-resolver.md#autoisolimits) | Type |
| [`EXPOSURE_MODE_RESOLVER_VERSION`](api/exposure-exposure-mode-resolver.md#exposure_mode_resolver_version) | Runtime |
| [`ExposureResolutionConstraint`](api/exposure-exposure-mode-resolver.md#exposureresolutionconstraint) | Type |
| [`ExposureTargetResidual`](api/exposure-exposure-mode-resolver.md#exposuretargetresidual) | Type |
| [`ExposureTargetResidualState`](api/exposure-exposure-mode-resolver.md#exposuretargetresidualstate) | Type |
| [`FullAutoExposureModeResolution`](api/exposure-exposure-mode-resolver.md#fullautoexposuremoderesolution) | Type |
| [`FullAutoExposurePolicy`](api/exposure-exposure-mode-resolver.md#fullautoexposurepolicy) | Type |
| [`ManualExposureModeResolution`](api/exposure-exposure-mode-resolver.md#manualexposuremoderesolution) | Type |
| [`ManualIsoControl`](api/exposure-exposure-mode-resolver.md#manualisocontrol) | Type |
| [`ProgramAutoExposureModeResolution`](api/exposure-exposure-mode-resolver.md#programautoexposuremoderesolution) | Type |
| [`ProgramAutoIsoControl`](api/exposure-exposure-mode-resolver.md#programautoisocontrol) | Type |
| [`ProgramLineSelectionDiagnostics`](api/exposure-exposure-mode-resolver.md#programlineselectiondiagnostics) | Type |
| [`ProgramSlowestPreferredShutterPolicy`](api/exposure-exposure-mode-resolver.md#programslowestpreferredshutterpolicy) | Type |
| [`RelativeExposureControlAnchor`](api/exposure-exposure-mode-resolver.md#relativeexposurecontrolanchor) | Type |
| [`resolveAperturePriorityAutoIsoExposureMode`](api/exposure-exposure-mode-resolver.md#resolveaperturepriorityautoisoexposuremode) | Runtime |
| [`ResolveAperturePriorityAutoIsoExposureModeInput`](api/exposure-exposure-mode-resolver.md#resolveaperturepriorityautoisoexposuremodeinput) | Type |
| [`resolveAperturePriorityExposureMode`](api/exposure-exposure-mode-resolver.md#resolveaperturepriorityexposuremode) | Runtime |
| [`ResolveAperturePriorityExposureModeInput`](api/exposure-exposure-mode-resolver.md#resolveaperturepriorityexposuremodeinput) | Type |
| [`resolveFullAutoExposureMode`](api/exposure-exposure-mode-resolver.md#resolvefullautoexposuremode) | Runtime |
| [`ResolveFullAutoExposureModeInput`](api/exposure-exposure-mode-resolver.md#resolvefullautoexposuremodeinput) | Type |
| [`resolveManualExposureMode`](api/exposure-exposure-mode-resolver.md#resolvemanualexposuremode) | Runtime |
| [`ResolveManualExposureModeInput`](api/exposure-exposure-mode-resolver.md#resolvemanualexposuremodeinput) | Type |
| [`resolveProgramAutoExposureMode`](api/exposure-exposure-mode-resolver.md#resolveprogramautoexposuremode) | Runtime |
| [`ResolveProgramAutoExposureModeInput`](api/exposure-exposure-mode-resolver.md#resolveprogramautoexposuremodeinput) | Type |
| [`resolveShutterPriorityExposureMode`](api/exposure-exposure-mode-resolver.md#resolveshutterpriorityexposuremode) | Runtime |
| [`ResolveShutterPriorityExposureModeInput`](api/exposure-exposure-mode-resolver.md#resolveshutterpriorityexposuremodeinput) | Type |
| [`ShutterPriorityAutoIsoPolicy`](api/exposure-exposure-mode-resolver.md#shutterpriorityautoisopolicy) | Type |
| [`ShutterPriorityExposureModeResolution`](api/exposure-exposure-mode-resolver.md#shutterpriorityexposuremoderesolution) | Type |

## exposure/exposure.ts

[Detailed contracts](api/exposure-exposure.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/exposure.ts)

| Export | Kind |
| --- | --- |
| [`calculateEquivalentIso`](api/exposure-exposure.md#calculateequivalentiso) | Runtime |
| [`CalculateEquivalentIsoInput`](api/exposure-exposure.md#calculateequivalentisoinput) | Type |
| [`calculateExposureValue100`](api/exposure-exposure.md#calculateexposurevalue100) | Runtime |
| [`CalculateExposureValue100Input`](api/exposure-exposure.md#calculateexposurevalue100input) | Type |
| [`calculateRelativeOpticalExposure`](api/exposure-exposure.md#calculaterelativeopticalexposure) | Runtime |
| [`CalculateRelativeOpticalExposureInput`](api/exposure-exposure.md#calculaterelativeopticalexposureinput) | Type |
| [`calculateRelativeRenderedExposure`](api/exposure-exposure.md#calculaterelativerenderedexposure) | Runtime |
| [`CalculateRelativeRenderedExposureInput`](api/exposure-exposure.md#calculaterelativerenderedexposureinput) | Type |
| [`RelativeOpticalExposure`](api/exposure-exposure.md#relativeopticalexposure) | Type |
| [`RelativeRenderedExposure`](api/exposure-exposure.md#relativerenderedexposure) | Type |

## exposure/filtered-exposure-time.ts

[Detailed contracts](api/exposure-filtered-exposure-time.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/filtered-exposure-time.ts)

| Export | Kind |
| --- | --- |
| [`calculateFilteredExposureTime`](api/exposure-filtered-exposure-time.md#calculatefilteredexposuretime) | Runtime |
| [`CalculateFilteredExposureTimeInput`](api/exposure-filtered-exposure-time.md#calculatefilteredexposuretimeinput) | Type |
| [`FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS`](api/exposure-filtered-exposure-time.md#filtered_exposure_default_wavelength_nanometers) | Runtime |
| [`FilteredExposureDialSetting`](api/exposure-filtered-exposure-time.md#filteredexposuredialsetting) | Type |
| [`FilteredExposureTime`](api/exposure-filtered-exposure-time.md#filteredexposuretime) | Type |

## exposure/flash-ttl.ts

[Detailed contracts](api/exposure-flash-ttl.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/flash-ttl.ts)

| Export | Kind |
| --- | --- |
| [`calculateFlashGuideNumber`](api/exposure-flash-ttl.md#calculateflashguidenumber) | Runtime |
| [`calculateFlashPowerForDistance`](api/exposure-flash-ttl.md#calculateflashpowerfordistance) | Runtime |
| [`createTtlScaledFlashProfile`](api/exposure-flash-ttl.md#createttlscaledflashprofile) | Runtime |
| [`FlashGuideNumberInput`](api/exposure-flash-ttl.md#flashguidenumberinput) | Type |
| [`FlashPowerForDistance`](api/exposure-flash-ttl.md#flashpowerfordistance) | Type |
| [`FlashPowerForDistanceInput`](api/exposure-flash-ttl.md#flashpowerfordistanceinput) | Type |
| [`resolveTtlFlashExposure`](api/exposure-flash-ttl.md#resolvettlflashexposure) | Runtime |
| [`ResolveTtlFlashExposureInput`](api/exposure-flash-ttl.md#resolvettlflashexposureinput) | Type |
| [`TTL_FLASH_MODEL`](api/exposure-flash-ttl.md#ttl_flash_model) | Runtime |
| [`TtlFlashExposure`](api/exposure-flash-ttl.md#ttlflashexposure) | Type |

## exposure/flash.ts

[Detailed contracts](api/exposure-flash.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/flash.ts)

| Export | Kind |
| --- | --- |
| [`createHighSpeedSyncIlluminationOverlay`](api/exposure-flash.md#createhighspeedsyncilluminationoverlay) | Runtime |
| [`createManualFlashIlluminationOverlay`](api/exposure-flash.md#createmanualflashilluminationoverlay) | Runtime |
| [`CreateManualFlashIlluminationOverlayInput`](api/exposure-flash.md#createmanualflashilluminationoverlayinput) | Type |
| [`FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION`](api/exposure-flash.md#flash_sync_capability_hss_schema_version) | Runtime |
| [`FLASH_SYNC_CAPABILITY_SCHEMA_VERSION`](api/exposure-flash.md#flash_sync_capability_schema_version) | Runtime |
| [`FlashOverlaySyncRegistration`](api/exposure-flash.md#flashoverlaysyncregistration) | Type |
| [`FlashSyncCapabilityProfile`](api/exposure-flash.md#flashsynccapabilityprofile) | Type |
| [`HIGH_SPEED_SYNC_MODEL`](api/exposure-flash.md#high_speed_sync_model) | Runtime |
| [`MANUAL_FLASH_PROFILE_SCHEMA_VERSION`](api/exposure-flash.md#manual_flash_profile_schema_version) | Runtime |
| [`ManualFlashIlluminationOverlay`](api/exposure-flash.md#manualflashilluminationoverlay) | Type |
| [`ManualFlashProfile`](api/exposure-flash.md#manualflashprofile) | Type |
| [`ManualFlashPulseProfile`](api/exposure-flash.md#manualflashpulseprofile) | Type |
| [`ManualFlashSyncMode`](api/exposure-flash.md#manualflashsyncmode) | Type |
| [`parseFlashSyncCapabilityProfile`](api/exposure-flash.md#parseflashsynccapabilityprofile) | Runtime |
| [`parseManualFlashProfile`](api/exposure-flash.md#parsemanualflashprofile) | Runtime |
| [`RequestedFlashSyncMode`](api/exposure-flash.md#requestedflashsyncmode) | Type |
| [`ResolvedHighSpeedFlashSync`](api/exposure-flash.md#resolvedhighspeedflashsync) | Type |
| [`ResolvedManualFlashSync`](api/exposure-flash.md#resolvedmanualflashsync) | Type |
| [`resolveHighSpeedFlashSync`](api/exposure-flash.md#resolvehighspeedflashsync) | Runtime |
| [`ResolveHighSpeedFlashSyncInput`](api/exposure-flash.md#resolvehighspeedflashsyncinput) | Type |
| [`resolveManualFlashSync`](api/exposure-flash.md#resolvemanualflashsync) | Runtime |
| [`ResolveManualFlashSyncInput`](api/exposure-flash.md#resolvemanualflashsyncinput) | Type |

## exposure/metering-scene-radiance.ts

[Detailed contracts](api/exposure-metering-scene-radiance.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/metering-scene-radiance.ts)

| Export | Kind |
| --- | --- |
| [`createSceneRadianceDerivedExposureMeteringSampleSet`](api/exposure-metering-scene-radiance.md#createsceneradiancederivedexposuremeteringsampleset) | Runtime |
| [`CreateSceneRadianceDerivedExposureMeteringSampleSetInput`](api/exposure-metering-scene-radiance.md#createsceneradiancederivedexposuremeteringsamplesetinput) | Type |
| [`parseSceneRadianceMeteringDerivationProfile`](api/exposure-metering-scene-radiance.md#parsesceneradiancemeteringderivationprofile) | Runtime |
| [`SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION`](api/exposure-metering-scene-radiance.md#scene_radiance_metering_derivation_schema_version) | Runtime |
| [`SceneRadianceDerivedExposureMeteringSampleSet`](api/exposure-metering-scene-radiance.md#sceneradiancederivedexposuremeteringsampleset) | Type |
| [`SceneRadianceMeteringDerivationProfile`](api/exposure-metering-scene-radiance.md#sceneradiancemeteringderivationprofile) | Type |
| [`SceneRadianceMeteringSourceContext`](api/exposure-metering-scene-radiance.md#sceneradiancemeteringsourcecontext) | Type |
| [`SceneRadianceMeteringTemporalContext`](api/exposure-metering-scene-radiance.md#sceneradiancemeteringtemporalcontext) | Type |

## exposure/metering-target.ts

[Detailed contracts](api/exposure-metering-target.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/metering-target.ts)

| Export | Kind |
| --- | --- |
| [`createExposureMeterTargetFromMeteringResult`](api/exposure-metering-target.md#createexposuremetertargetfrommeteringresult) | Runtime |
| [`CreateExposureMeterTargetInput`](api/exposure-metering-target.md#createexposuremetertargetinput) | Type |
| [`EXPOSURE_METER_TARGET_SCHEMA_VERSION`](api/exposure-metering-target.md#exposure_meter_target_schema_version) | Runtime |
| [`ExposureMeterSnapshotIdentity`](api/exposure-metering-target.md#exposuremetersnapshotidentity) | Type |
| [`ExposureMeterTarget`](api/exposure-metering-target.md#exposuremetertarget) | Type |
| [`ExposureMeterTargetSourceKind`](api/exposure-metering-target.md#exposuremetertargetsourcekind) | Type |
| [`ExposureMeterTargetSourceResult`](api/exposure-metering-target.md#exposuremetertargetsourceresult) | Type |
| [`setExposureCompensationOnMeterTarget`](api/exposure-metering-target.md#setexposurecompensationonmetertarget) | Runtime |
| [`SetExposureCompensationOnMeterTargetInput`](api/exposure-metering-target.md#setexposurecompensationonmetertargetinput) | Type |

## exposure/metering-temporal.ts

[Detailed contracts](api/exposure-metering-temporal.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/metering-temporal.ts)

| Export | Kind |
| --- | --- |
| [`meterSceneRadianceTemporalExposure`](api/exposure-metering-temporal.md#metersceneradiancetemporalexposure) | Runtime |
| [`MeterSceneRadianceTemporalExposureInput`](api/exposure-metering-temporal.md#metersceneradiancetemporalexposureinput) | Type |
| [`SceneRadianceTemporalExposureMeteringResult`](api/exposure-metering-temporal.md#sceneradiancetemporalexposuremeteringresult) | Type |
| [`SceneRadianceTemporalMeteringSample`](api/exposure-metering-temporal.md#sceneradiancetemporalmeteringsample) | Type |

## exposure/metering.ts

[Detailed contracts](api/exposure-metering.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/metering.ts)

| Export | Kind |
| --- | --- |
| [`calculateHighlightPriorityPlacementSignal`](api/exposure-metering.md#calculatehighlightpriorityplacementsignal) | Runtime |
| [`EXPOSURE_METERING_PROFILE_SCHEMA_VERSION`](api/exposure-metering.md#exposure_metering_profile_schema_version) | Runtime |
| [`ExposureMeteringPolicy`](api/exposure-metering.md#exposuremeteringpolicy) | Type |
| [`ExposureMeteringProfile`](api/exposure-metering.md#exposuremeteringprofile) | Type |
| [`ExposureMeteringResult`](api/exposure-metering.md#exposuremeteringresult) | Type |
| [`ExposureMeteringSampleSet`](api/exposure-metering.md#exposuremeteringsampleset) | Type |
| [`ExposureMeteringZoneSample`](api/exposure-metering.md#exposuremeteringzonesample) | Type |
| [`HighlightPriorityMeteringDiagnostics`](api/exposure-metering.md#highlightprioritymeteringdiagnostics) | Type |
| [`meterRelativeExposure`](api/exposure-metering.md#meterrelativeexposure) | Runtime |
| [`MeterRelativeExposureInput`](api/exposure-metering.md#meterrelativeexposureinput) | Type |
| [`parseExposureMeteringProfile`](api/exposure-metering.md#parseexposuremeteringprofile) | Runtime |

## exposure/program-line.ts

[Detailed contracts](api/exposure-program-line.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/exposure/program-line.ts)

| Export | Kind |
| --- | --- |
| [`EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION`](api/exposure-program-line.md#exposure_program_line_schema_version) | Runtime |
| [`ExposureProgramLineNode`](api/exposure-program-line.md#exposureprogramlinenode) | Type |
| [`ExposureProgramLineProfile`](api/exposure-program-line.md#exposureprogramlineprofile) | Type |
| [`parseExposureProgramLineProfile`](api/exposure-program-line.md#parseexposureprogramlineprofile) | Runtime |

## facade/chart-material-layers.ts

[Detailed contracts](api/facade-chart-material-layers.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/chart-material-layers.ts)

| Export | Kind |
| --- | --- |
| [`CHART_MASK_INDEX_GRAIN`](api/facade-chart-material-layers.md#chart_mask_index_grain) | Runtime |
| [`CHART_MATERIAL_LAYER_LIMITS`](api/facade-chart-material-layers.md#chart_material_layer_limits) | Runtime |
| [`ChartMaskAnnulus`](api/facade-chart-material-layers.md#chartmaskannulus) | Type |
| [`ChartMaskLayer`](api/facade-chart-material-layers.md#chartmasklayer) | Type |
| [`ChartMaskPolygon`](api/facade-chart-material-layers.md#chartmaskpolygon) | Type |
| [`ChartMaskShape`](api/facade-chart-material-layers.md#chartmaskshape) | Type |
| [`ChartMaterialLayerScene`](api/facade-chart-material-layers.md#chartmateriallayerscene) | Type |
| [`resolveChartMaterialLayers`](api/facade-chart-material-layers.md#resolvechartmateriallayers) | Runtime |
| [`ResolvedChartMaskLayer`](api/facade-chart-material-layers.md#resolvedchartmasklayer) | Type |
| [`ResolvedChartMaskShape`](api/facade-chart-material-layers.md#resolvedchartmaskshape) | Type |
| [`ResolvedChartMaterialLayers`](api/facade-chart-material-layers.md#resolvedchartmateriallayers) | Type |

## facade/chart-radiance-batch.ts

[Detailed contracts](api/facade-chart-radiance-batch.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/chart-radiance-batch.ts)

| Export | Kind |
| --- | --- |
| [`calculateChartRadianceBatch`](api/facade-chart-radiance-batch.md#calculatechartradiancebatch) | Runtime |
| [`calculateChartRadianceBatchPlan`](api/facade-chart-radiance-batch.md#calculatechartradiancebatchplan) | Runtime |
| [`CHART_RADIANCE_BATCH_LIMITS`](api/facade-chart-radiance-batch.md#chart_radiance_batch_limits) | Runtime |
| [`CHART_RADIANCE_BATCH_SCHEMA_VERSION`](api/facade-chart-radiance-batch.md#chart_radiance_batch_schema_version) | Runtime |
| [`ChartRadianceBatchInput`](api/facade-chart-radiance-batch.md#chartradiancebatchinput) | Type |
| [`ChartRadianceBatchPlan`](api/facade-chart-radiance-batch.md#chartradiancebatchplan) | Type |
| [`mapEnvironmentDirectionsToChartPoints`](api/facade-chart-radiance-batch.md#mapenvironmentdirectionstochartpoints) | Runtime |

## facade/chart-scenes.ts

[Detailed contracts](api/facade-chart-scenes.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/chart-scenes.ts)

| Export | Kind |
| --- | --- |
| [`BarGroupsChartScene`](api/facade-chart-scenes.md#bargroupschartscene) | Type |
| [`calculateBarGroupTargets`](api/facade-chart-scenes.md#calculatebargrouptargets) | Runtime |
| [`calculatePointGridCenters`](api/facade-chart-scenes.md#calculatepointgridcenters) | Runtime |
| [`calculateSlantedSquareEdges`](api/facade-chart-scenes.md#calculateslantedsquareedges) | Runtime |
| [`calculateStepWedgeReflectances`](api/facade-chart-scenes.md#calculatestepwedgereflectances) | Runtime |
| [`CHART_CONTINUOUS_LEVELS`](api/facade-chart-scenes.md#chart_continuous_levels) | Runtime |
| [`CHART_SCENE_DEFAULTS`](api/facade-chart-scenes.md#chart_scene_defaults) | Runtime |
| [`CHART_SCENE_PRESETS`](api/facade-chart-scenes.md#chart_scene_presets) | Runtime |
| [`CHART_SPECTRAL_RANGE_NANOMETERS`](api/facade-chart-scenes.md#chart_spectral_range_nanometers) | Runtime |
| [`ChartBarGroupTarget`](api/facade-chart-scenes.md#chartbargrouptarget) | Type |
| [`ChartElementScene`](api/facade-chart-scenes.md#chartelementscene) | Type |
| [`ChartRectangle`](api/facade-chart-scenes.md#chartrectangle) | Type |
| [`ChartReflectance`](api/facade-chart-scenes.md#chartreflectance) | Type |
| [`ChartScene`](api/facade-chart-scenes.md#chartscene) | Type |
| [`ChartScenePresetId`](api/facade-chart-scenes.md#chartscenepresetid) | Type |
| [`ChartSlantedSquare`](api/facade-chart-scenes.md#chartslantedsquare) | Type |
| [`CheckerboardChartScene`](api/facade-chart-scenes.md#checkerboardchartscene) | Type |
| [`ColorPatchesChartScene`](api/facade-chart-scenes.md#colorpatcheschartscene) | Type |
| [`ColorPatchReflectance`](api/facade-chart-scenes.md#colorpatchreflectance) | Type |
| [`CompositeChartElement`](api/facade-chart-scenes.md#compositechartelement) | Type |
| [`CompositeChartScene`](api/facade-chart-scenes.md#compositechartscene) | Type |
| [`DeadLeavesChartScene`](api/facade-chart-scenes.md#deadleaveschartscene) | Type |
| [`FiducialChartScene`](api/facade-chart-scenes.md#fiducialchartscene) | Type |
| [`GreyRampChartScene`](api/facade-chart-scenes.md#greyrampchartscene) | Type |
| [`HyperbolicWedgeChartScene`](api/facade-chart-scenes.md#hyperbolicwedgechartscene) | Type |
| [`LineGridChartScene`](api/facade-chart-scenes.md#linegridchartscene) | Type |
| [`PatchChartScene`](api/facade-chart-scenes.md#patchchartscene) | Type |
| [`PointGridChartScene`](api/facade-chart-scenes.md#pointgridchartscene) | Type |
| [`resolveChartScene`](api/facade-chart-scenes.md#resolvechartscene) | Runtime |
| [`ResolvedChartScene`](api/facade-chart-scenes.md#resolvedchartscene) | Type |
| [`SiemensStarChartScene`](api/facade-chart-scenes.md#siemensstarchartscene) | Type |
| [`SlantedEdgeChartScene`](api/facade-chart-scenes.md#slantededgechartscene) | Type |
| [`SlantedSquaresChartScene`](api/facade-chart-scenes.md#slantedsquareschartscene) | Type |
| [`StepWedgeChartScene`](api/facade-chart-scenes.md#stepwedgechartscene) | Type |
| [`UniformChartScene`](api/facade-chart-scenes.md#uniformchartscene) | Type |
| [`ZonePlateChartScene`](api/facade-chart-scenes.md#zoneplatechartscene) | Type |

## facade/color-patches.ts

[Detailed contracts](api/facade-color-patches.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/color-patches.ts)

| Export | Kind |
| --- | --- |
| [`COLOR_PATCH_IDS`](api/facade-color-patches.md#color_patch_ids) | Runtime |
| [`COLOR_PATCH_SET_ID`](api/facade-color-patches.md#color_patch_set_id) | Runtime |
| [`COLOR_PATCH_SET_VERSION`](api/facade-color-patches.md#color_patch_set_version) | Runtime |
| [`COLOR_PATCH_WAVELENGTH_RANGE_NANOMETERS`](api/facade-color-patches.md#color_patch_wavelength_range_nanometers) | Runtime |
| [`ColorPatch`](api/facade-color-patches.md#colorpatch) | Type |
| [`ColorPatchGroup`](api/facade-color-patches.md#colorpatchgroup) | Type |
| [`ColorPatchId`](api/facade-color-patches.md#colorpatchid) | Type |
| [`ColorPatchSet`](api/facade-color-patches.md#colorpatchset) | Type |
| [`ColorPatchSpectralTerm`](api/facade-color-patches.md#colorpatchspectralterm) | Type |
| [`evaluateColorPatchReflectance`](api/facade-color-patches.md#evaluatecolorpatchreflectance) | Runtime |
| [`EvaluateColorPatchReflectanceInput`](api/facade-color-patches.md#evaluatecolorpatchreflectanceinput) | Type |
| [`getColorPatchSet`](api/facade-color-patches.md#getcolorpatchset) | Runtime |

## facade/develop-joined-parts.ts

[Detailed contracts](api/facade-develop-joined-parts.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/develop-joined-parts.ts)

| Export | Kind |
| --- | --- |
| [`simulateCaptureFromParts`](api/facade-develop-joined-parts.md#simulatecapturefromparts) | Runtime |

## facade/display-view-gpu.ts

[Detailed contracts](api/facade-display-view-gpu.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/display-view-gpu.ts)

| Export | Kind |
| --- | --- |
| [`DisplayViewExecution`](api/facade-display-view-gpu.md#displayviewexecution) | Type |
| [`DisplayViewFastReport`](api/facade-display-view-gpu.md#displayviewfastreport) | Type |
| [`DisplayViewGpuConformance`](api/facade-display-view-gpu.md#displayviewgpuconformance) | Type |
| [`DisplayViewGpuFallbackReason`](api/facade-display-view-gpu.md#displayviewgpufallbackreason) | Type |
| [`DisplayViewGpuMode`](api/facade-display-view-gpu.md#displayviewgpumode) | Type |
| [`PrepareDisplayViewOptions`](api/facade-display-view-gpu.md#preparedisplayviewoptions) | Type |

## facade/display-view.ts

[Detailed contracts](api/facade-display-view.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/display-view.ts)

| Export | Kind |
| --- | --- |
| [`bindDisplayViewCorrectionStates`](api/facade-display-view.md#binddisplayviewcorrectionstates) | Runtime |
| [`DisplayViewCorrectionStateKeys`](api/facade-display-view.md#displayviewcorrectionstatekeys) | Type |
| [`DisplayViewCorrectionStateSet`](api/facade-display-view.md#displayviewcorrectionstateset) | Type |
| [`serializeDisplayViewCorrectionStates`](api/facade-display-view.md#serializedisplayviewcorrectionstates) | Runtime |

## facade/scene-radiance.ts

[Detailed contracts](api/facade-scene-radiance.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/scene-radiance.ts)

| Export | Kind |
| --- | --- |
| [`CALLER_MATERIAL_SCENE_MAX_MATERIALS`](api/facade-scene-radiance.md#caller_material_scene_max_materials) | Runtime |
| [`CallerMaterialScene`](api/facade-scene-radiance.md#callermaterialscene) | Type |
| [`CallerRadianceScene`](api/facade-scene-radiance.md#callerradiancescene) | Type |
| [`CallerReflectanceScene`](api/facade-scene-radiance.md#callerreflectancescene) | Type |
| [`CaptureIlluminant`](api/facade-scene-radiance.md#captureilluminant) | Type |
| [`CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE`](api/facade-scene-radiance.md#chart_size_default_surround_reflectance) | Runtime |
| [`ChartSizeOption`](api/facade-scene-radiance.md#chartsizeoption) | Type |
| [`createPlanarSceneRadianceProvider`](api/facade-scene-radiance.md#createplanarsceneradianceprovider) | Runtime |
| [`PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W`](api/facade-scene-radiance.md#photopic_maximum_luminous_efficacy_lm_per_w) | Runtime |
| [`PlanarSceneRadianceProvider`](api/facade-scene-radiance.md#planarsceneradianceprovider) | Type |
| [`resolveCaptureIlluminant`](api/facade-scene-radiance.md#resolvecaptureilluminant) | Runtime |
| [`ResolvedCaptureIlluminant`](api/facade-scene-radiance.md#resolvedcaptureilluminant) | Type |
| [`SceneMaterialPoint`](api/facade-scene-radiance.md#scenematerialpoint) | Type |
| [`ScenePlanePoint`](api/facade-scene-radiance.md#sceneplanepoint) | Type |

## facade/simulate-capture.ts

[Detailed contracts](api/facade-simulate-capture.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/simulate-capture.ts)

| Export | Kind |
| --- | --- |
| [`DisplayViewHighlightDiagnostics`](api/facade-simulate-capture.md#displayviewhighlightdiagnostics) | Type |
| [`DisplayViewResult`](api/facade-simulate-capture.md#displayviewresult) | Type |
| [`IdealReferenceResult`](api/facade-simulate-capture.md#idealreferenceresult) | Type |
| [`serializeSimulatedCaptureDngFromParts`](api/facade-simulate-capture.md#serializesimulatedcapturedngfromparts) | Runtime |
| [`SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES`](api/facade-simulate-capture.md#simulate_capture_box_aperture_default_samples) | Runtime |
| [`SIMULATE_CAPTURE_COST_OPTIONS`](api/facade-simulate-capture.md#simulate_capture_cost_options) | Runtime |
| [`SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX`](api/facade-simulate-capture.md#simulate_capture_default_illuminance_lux) | Runtime |
| [`SIMULATE_CAPTURE_FACADE_VERSION`](api/facade-simulate-capture.md#simulate_capture_facade_version) | Runtime |
| [`SIMULATE_CAPTURE_FAST_OPTIONS`](api/facade-simulate-capture.md#simulate_capture_fast_options) | Runtime |
| [`SIMULATE_CAPTURE_METERING_MODES`](api/facade-simulate-capture.md#simulate_capture_metering_modes) | Runtime |
| [`SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS`](api/facade-simulate-capture.md#simulate_display_view_default_samples_per_axis) | Runtime |
| [`simulateCapture`](api/facade-simulate-capture.md#simulatecapture) | Runtime |
| [`SimulateCaptureAssumption`](api/facade-simulate-capture.md#simulatecaptureassumption) | Type |
| [`SimulateCaptureAutoIsoAfterMaximum`](api/facade-simulate-capture.md#simulatecaptureautoisoaftermaximum) | Type |
| [`SimulateCaptureAutoIsoReport`](api/facade-simulate-capture.md#simulatecaptureautoisoreport) | Type |
| [`SimulateCaptureAutomaticSlowestShutterOptions`](api/facade-simulate-capture.md#simulatecaptureautomaticslowestshutteroptions) | Type |
| [`SimulateCaptureAutomaticSlowestShutterReport`](api/facade-simulate-capture.md#simulatecaptureautomaticslowestshutterreport) | Type |
| [`SimulateCaptureBorderHandling`](api/facade-simulate-capture.md#simulatecaptureborderhandling) | Type |
| [`SimulateCaptureColorEncoding`](api/facade-simulate-capture.md#simulatecapturecolorencoding) | Type |
| [`SimulateCaptureCostOption`](api/facade-simulate-capture.md#simulatecapturecostoption) | Type |
| [`SimulateCaptureDemosaic`](api/facade-simulate-capture.md#simulatecapturedemosaic) | Type |
| [`SimulateCaptureDemosaicRecord`](api/facade-simulate-capture.md#simulatecapturedemosaicrecord) | Type |
| [`SimulateCaptureDetailDiagnostics`](api/facade-simulate-capture.md#simulatecapturedetaildiagnostics) | Type |
| [`SimulateCaptureDiffractionCorrection`](api/facade-simulate-capture.md#simulatecapturediffractioncorrection) | Type |
| [`SimulateCaptureDngPart`](api/facade-simulate-capture.md#simulatecapturedngpart) | Type |
| [`SimulateCaptureExposureMode`](api/facade-simulate-capture.md#simulatecaptureexposuremode) | Type |
| [`SimulateCaptureFastOption`](api/facade-simulate-capture.md#simulatecapturefastoption) | Type |
| [`SimulateCaptureFastReport`](api/facade-simulate-capture.md#simulatecapturefastreport) | Type |
| [`SimulateCaptureLensCatalogueRecord`](api/facade-simulate-capture.md#simulatecapturelenscataloguerecord) | Type |
| [`SimulateCaptureLensCorrections`](api/facade-simulate-capture.md#simulatecapturelenscorrections) | Type |
| [`SimulateCaptureLensDistortion`](api/facade-simulate-capture.md#simulatecapturelensdistortion) | Type |
| [`SimulateCaptureMetering`](api/facade-simulate-capture.md#simulatecapturemetering) | Type |
| [`SimulateCaptureMotion`](api/facade-simulate-capture.md#simulatecapturemotion) | Type |
| [`SimulateCaptureOptions`](api/facade-simulate-capture.md#simulatecaptureoptions) | Type |
| [`SimulateCaptureOutputFormat`](api/facade-simulate-capture.md#simulatecaptureoutputformat) | Type |
| [`SimulateCapturePixelAperture`](api/facade-simulate-capture.md#simulatecapturepixelaperture) | Type |
| [`SimulateCaptureProgress`](api/facade-simulate-capture.md#simulatecaptureprogress) | Type |
| [`SimulateCaptureResult`](api/facade-simulate-capture.md#simulatecaptureresult) | Type |
| [`SimulateCaptureSensorAntiAliasing`](api/facade-simulate-capture.md#simulatecapturesensorantialiasing) | Type |
| [`SimulateCaptureSharpening`](api/facade-simulate-capture.md#simulatecapturesharpening) | Type |
| [`SimulateCaptureWhiteBalance`](api/facade-simulate-capture.md#simulatecapturewhitebalance) | Type |
| [`SimulateDisplayViewOptions`](api/facade-simulate-capture.md#simulatedisplayviewoptions) | Type |
| [`simulateIdealReference`](api/facade-simulate-capture.md#simulateidealreference) | Runtime |

## facade/simulate-display-view.ts

[Detailed contracts](api/facade-simulate-display-view.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/simulate-display-view.ts)

| Export | Kind |
| --- | --- |
| [`PreparedDisplayView`](api/facade-simulate-display-view.md#prepareddisplayview) | Type |
| [`PreparedDisplayViewRenderOptions`](api/facade-simulate-display-view.md#prepareddisplayviewrenderoptions) | Type |
| [`prepareDisplayView`](api/facade-simulate-display-view.md#preparedisplayview) | Runtime |
| [`simulateDisplayView`](api/facade-simulate-display-view.md#simulatedisplayview) | Runtime |

## facade/subject-framing.ts

[Detailed contracts](api/facade-subject-framing.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/facade/subject-framing.ts)

| Export | Kind |
| --- | --- |
| [`calculateChartFraming`](api/facade-subject-framing.md#calculatechartframing) | Runtime |
| [`CalculateChartFramingInput`](api/facade-subject-framing.md#calculatechartframinginput) | Type |
| [`calculateSubjectDistanceForFraming`](api/facade-subject-framing.md#calculatesubjectdistanceforframing) | Runtime |
| [`CalculateSubjectDistanceForFramingInput`](api/facade-subject-framing.md#calculatesubjectdistanceforframinginput) | Type |
| [`ChartFraming`](api/facade-subject-framing.md#chartframing) | Type |
| [`SubjectFraming`](api/facade-subject-framing.md#subjectframing) | Type |
| [`SubjectFramingFit`](api/facade-subject-framing.md#subjectframingfit) | Type |

## gpu/image-kernel-accelerator.ts

[Detailed contracts](api/gpu-image-kernel-accelerator.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/gpu/image-kernel-accelerator.ts)

| Export | Kind |
| --- | --- |
| [`AcceleratedNativeCaptureSdrOutput`](api/gpu-image-kernel-accelerator.md#acceleratednativecapturesdroutput) | Type |
| [`AcceleratedNativeRawDevelopmentOutput`](api/gpu-image-kernel-accelerator.md#acceleratednativerawdevelopmentoutput) | Type |
| [`AcceleratedPackedSensorRawResult`](api/gpu-image-kernel-accelerator.md#acceleratedpackedsensorrawresult) | Type |
| [`ChartRadianceResult`](api/gpu-image-kernel-accelerator.md#chartradianceresult) | Type |
| [`createImageKernelAccelerator`](api/gpu-image-kernel-accelerator.md#createimagekernelaccelerator) | Runtime |
| [`ImageKernelAccelerator`](api/gpu-image-kernel-accelerator.md#imagekernelaccelerator) | Type |
| [`ImageKernelAcceleratorOptions`](api/gpu-image-kernel-accelerator.md#imagekernelacceleratoroptions) | Type |
| [`ImageKernelAcceleratorState`](api/gpu-image-kernel-accelerator.md#imagekernelacceleratorstate) | Type |
| [`ImageKernelRunOptions`](api/gpu-image-kernel-accelerator.md#imagekernelrunoptions) | Type |
| [`IrradianceConvolutionResult`](api/gpu-image-kernel-accelerator.md#irradianceconvolutionresult) | Type |
| [`TemporalExposureSumResult`](api/gpu-image-kernel-accelerator.md#temporalexposuresumresult) | Type |

## gpu/image-kernel-execution.ts

[Detailed contracts](api/gpu-image-kernel-execution.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/gpu/image-kernel-execution.ts)

| Export | Kind |
| --- | --- |
| [`ChartCompositeProbeComponent`](api/gpu-image-kernel-execution.md#chartcompositeprobecomponent) | Type |
| [`ChartCompositeProbeMismatch`](api/gpu-image-kernel-execution.md#chartcompositeprobemismatch) | Type |
| [`ChartCompositeProbeRecord`](api/gpu-image-kernel-execution.md#chartcompositeproberecord) | Type |
| [`composeRelativeErrorBounds`](api/gpu-image-kernel-execution.md#composerelativeerrorbounds) | Runtime |
| [`ImageKernelAdapterDescription`](api/gpu-image-kernel-execution.md#imagekerneladapterdescription) | Type |
| [`ImageKernelBackend`](api/gpu-image-kernel-execution.md#imagekernelbackend) | Type |
| [`ImageKernelCodeErrorBound`](api/gpu-image-kernel-execution.md#imagekernelcodeerrorbound) | Type |
| [`ImageKernelExecution`](api/gpu-image-kernel-execution.md#imagekernelexecution) | Type |
| [`ImageKernelExecutionError`](api/gpu-image-kernel-execution.md#imagekernelexecutionerror) | Runtime |
| [`ImageKernelFailureReason`](api/gpu-image-kernel-execution.md#imagekernelfailurereason) | Type |
| [`ImageKernelFallbackReason`](api/gpu-image-kernel-execution.md#imagekernelfallbackreason) | Type |
| [`ImageKernelRelativeErrorBound`](api/gpu-image-kernel-execution.md#imagekernelrelativeerrorbound) | Type |
| [`ImageKernelSeededRealizationBound`](api/gpu-image-kernel-execution.md#imagekernelseededrealizationbound) | Type |
| [`WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND`](api/gpu-image-kernel-execution.md#webgpu_f32_transfer_absolute_bound) | Runtime |
| [`WEBGPU_F32_UNIT_ROUNDOFF`](api/gpu-image-kernel-execution.md#webgpu_f32_unit_roundoff) | Runtime |

## gpu/webgpu-switch.ts

[Detailed contracts](api/gpu-webgpu-switch.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/gpu/webgpu-switch.ts)

| Export | Kind |
| --- | --- |
| [`getWebGpuEnabled`](api/gpu-webgpu-switch.md#getwebgpuenabled) | Runtime |
| [`setWebGpuEnabled`](api/gpu-webgpu-switch.md#setwebgpuenabled) | Runtime |

## motion/camera-rotation.ts

[Detailed contracts](api/motion-camera-rotation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/camera-rotation.ts)

| Export | Kind |
| --- | --- |
| [`AxisSamplingPitchMicrometers`](api/motion-camera-rotation.md#axissamplingpitchmicrometers) | Type |
| [`calculateCameraRotationImageMapping`](api/motion-camera-rotation.md#calculatecamerarotationimagemapping) | Runtime |
| [`CalculateCameraRotationImageMappingInput`](api/motion-camera-rotation.md#calculatecamerarotationimagemappinginput) | Type |
| [`calculateInverseCameraRotationImageMapping`](api/motion-camera-rotation.md#calculateinversecamerarotationimagemapping) | Runtime |
| [`CalculateInverseCameraRotationImageMappingInput`](api/motion-camera-rotation.md#calculateinversecamerarotationimagemappinginput) | Type |
| [`CameraAngularVelocityRadPerSec`](api/motion-camera-rotation.md#cameraangularvelocityradpersec) | Type |
| [`CameraRotationImageMapping`](api/motion-camera-rotation.md#camerarotationimagemapping) | Type |
| [`ImagePlanePointMm`](api/motion-camera-rotation.md#imageplanepointmm) | Type |
| [`InverseCameraRotationImageMapping`](api/motion-camera-rotation.md#inversecamerarotationimagemapping) | Type |

## motion/capture-rotation-inverse-mapping.ts

[Detailed contracts](api/motion-capture-rotation-inverse-mapping.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/capture-rotation-inverse-mapping.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureRotationInverseMappings`](api/motion-capture-rotation-inverse-mapping.md#calculatecapturerotationinversemappings) | Runtime |
| [`CalculateCaptureRotationInverseMappingsInput`](api/motion-capture-rotation-inverse-mapping.md#calculatecapturerotationinversemappingsinput) | Type |
| [`CaptureRotationInverseMappings`](api/motion-capture-rotation-inverse-mapping.md#capturerotationinversemappings) | Type |
| [`CaptureRotationInverseMappingSample`](api/motion-capture-rotation-inverse-mapping.md#capturerotationinversemappingsample) | Type |

## motion/capture-rotation-temporal-quadrature.ts

[Detailed contracts](api/motion-capture-rotation-temporal-quadrature.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/capture-rotation-temporal-quadrature.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureRotationTemporalQuadrature`](api/motion-capture-rotation-temporal-quadrature.md#calculatecapturerotationtemporalquadrature) | Runtime |
| [`CalculateCaptureRotationTemporalQuadratureInput`](api/motion-capture-rotation-temporal-quadrature.md#calculatecapturerotationtemporalquadratureinput) | Type |
| [`CaptureRotationTemporalQuadrature`](api/motion-capture-rotation-temporal-quadrature.md#capturerotationtemporalquadrature) | Type |
| [`CaptureRotationTemporalQuadratureNode`](api/motion-capture-rotation-temporal-quadrature.md#capturerotationtemporalquadraturenode) | Type |
| [`CaptureRotationTemporalQuadraturePoint`](api/motion-capture-rotation-temporal-quadrature.md#capturerotationtemporalquadraturepoint) | Type |

## motion/capture-rotation-trajectory.ts

[Detailed contracts](api/motion-capture-rotation-trajectory.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/capture-rotation-trajectory.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureRotationTrajectories`](api/motion-capture-rotation-trajectory.md#calculatecapturerotationtrajectories) | Runtime |
| [`CalculateCaptureRotationTrajectoriesInput`](api/motion-capture-rotation-trajectory.md#calculatecapturerotationtrajectoriesinput) | Type |
| [`CaptureRotationTrajectories`](api/motion-capture-rotation-trajectory.md#capturerotationtrajectories) | Type |
| [`CaptureRotationTrajectoryEndpoint`](api/motion-capture-rotation-trajectory.md#capturerotationtrajectoryendpoint) | Type |
| [`CaptureRotationTrajectorySample`](api/motion-capture-rotation-trajectory.md#capturerotationtrajectorysample) | Type |

## motion/capture-translation-parallax-temporal-quadrature.ts

[Detailed contracts](api/motion-capture-translation-parallax-temporal-quadrature.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/capture-translation-parallax-temporal-quadrature.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureTranslationParallaxTemporalQuadrature`](api/motion-capture-translation-parallax-temporal-quadrature.md#calculatecapturetranslationparallaxtemporalquadrature) | Runtime |
| [`CalculateCaptureTranslationParallaxTemporalQuadratureInput`](api/motion-capture-translation-parallax-temporal-quadrature.md#calculatecapturetranslationparallaxtemporalquadratureinput) | Type |
| [`CaptureTranslationParallaxSceneSample`](api/motion-capture-translation-parallax-temporal-quadrature.md#capturetranslationparallaxscenesample) | Type |
| [`CaptureTranslationParallaxTemporalNode`](api/motion-capture-translation-parallax-temporal-quadrature.md#capturetranslationparallaxtemporalnode) | Type |
| [`CaptureTranslationParallaxTemporalQuadrature`](api/motion-capture-translation-parallax-temporal-quadrature.md#capturetranslationparallaxtemporalquadrature) | Type |
| [`CaptureTranslationParallaxTemporalSample`](api/motion-capture-translation-parallax-temporal-quadrature.md#capturetranslationparallaxtemporalsample) | Type |

## motion/extended-object-projection.ts

[Detailed contracts](api/motion-extended-object-projection.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/extended-object-projection.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureExtendedObjectTemporalProjection`](api/motion-extended-object-projection.md#calculatecaptureextendedobjecttemporalprojection) | Runtime |
| [`CalculateCaptureExtendedObjectTemporalProjectionInput`](api/motion-extended-object-projection.md#calculatecaptureextendedobjecttemporalprojectioninput) | Type |
| [`calculateExtendedObjectProjectionTrajectory`](api/motion-extended-object-projection.md#calculateextendedobjectprojectiontrajectory) | Runtime |
| [`CalculateExtendedObjectProjectionTrajectoryInput`](api/motion-extended-object-projection.md#calculateextendedobjectprojectiontrajectoryinput) | Type |
| [`CaptureExtendedObjectMetricPoint`](api/motion-extended-object-projection.md#captureextendedobjectmetricpoint) | Type |
| [`CaptureExtendedObjectPointTrajectory`](api/motion-extended-object-projection.md#captureextendedobjectpointtrajectory) | Type |
| [`CaptureExtendedObjectTemporalNode`](api/motion-extended-object-projection.md#captureextendedobjecttemporalnode) | Type |
| [`CaptureExtendedObjectTemporalProjection`](api/motion-extended-object-projection.md#captureextendedobjecttemporalprojection) | Type |
| [`ExtendedObjectFrontoparallelPlaneDeclaration`](api/motion-extended-object-projection.md#extendedobjectfrontoparallelplanedeclaration) | Type |
| [`ExtendedObjectMetricPoint`](api/motion-extended-object-projection.md#extendedobjectmetricpoint) | Type |
| [`ExtendedObjectPlanarMagnificationDiagnostic`](api/motion-extended-object-projection.md#extendedobjectplanarmagnificationdiagnostic) | Type |
| [`ExtendedObjectPointProjectionTrajectory`](api/motion-extended-object-projection.md#extendedobjectpointprojectiontrajectory) | Type |
| [`ExtendedObjectProjectionNode`](api/motion-extended-object-projection.md#extendedobjectprojectionnode) | Type |
| [`ExtendedObjectProjectionTrajectory`](api/motion-extended-object-projection.md#extendedobjectprojectiontrajectory) | Type |

## motion/projected-motion.ts

[Detailed contracts](api/motion-projected-motion.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/projected-motion.ts)

| Export | Kind |
| --- | --- |
| [`calculateProjectedMotionBlur`](api/motion-projected-motion.md#calculateprojectedmotionblur) | Runtime |
| [`CalculateProjectedMotionBlurInput`](api/motion-projected-motion.md#calculateprojectedmotionblurinput) | Type |
| [`ProjectedMotionBlur`](api/motion-projected-motion.md#projectedmotionblur) | Type |

## motion/temporal-exposure-sum.ts

[Detailed contracts](api/motion-temporal-exposure-sum.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/temporal-exposure-sum.ts)

| Export | Kind |
| --- | --- |
| [`calculateTemporalExposureSum`](api/motion-temporal-exposure-sum.md#calculatetemporalexposuresum) | Runtime |
| [`calculateTemporalExposureSumPlan`](api/motion-temporal-exposure-sum.md#calculatetemporalexposuresumplan) | Runtime |
| [`TEMPORAL_EXPOSURE_SUM_LIMITS`](api/motion-temporal-exposure-sum.md#temporal_exposure_sum_limits) | Runtime |
| [`TEMPORAL_EXPOSURE_SUM_SCHEMA_VERSION`](api/motion-temporal-exposure-sum.md#temporal_exposure_sum_schema_version) | Runtime |
| [`TemporalExposureSumInput`](api/motion-temporal-exposure-sum.md#temporalexposuresuminput) | Type |
| [`TemporalExposureSumNode`](api/motion-temporal-exposure-sum.md#temporalexposuresumnode) | Type |
| [`TemporalExposureSumPlan`](api/motion-temporal-exposure-sum.md#temporalexposuresumplan) | Type |

## motion/video-sequence.ts

[Detailed contracts](api/motion-video-sequence.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/motion/video-sequence.ts)

| Export | Kind |
| --- | --- |
| [`assessShutterAngleRule`](api/motion-video-sequence.md#assessshutteranglerule) | Runtime |
| [`calculateShutterAngleExposureSeconds`](api/motion-video-sequence.md#calculateshutterangleexposureseconds) | Runtime |
| [`calculateShutterAngleFromExposureSeconds`](api/motion-video-sequence.md#calculateshutteranglefromexposureseconds) | Runtime |
| [`resolveVideoFrameSequence`](api/motion-video-sequence.md#resolvevideoframesequence) | Runtime |
| [`ResolveVideoFrameSequenceInput`](api/motion-video-sequence.md#resolvevideoframesequenceinput) | Type |
| [`ShutterAngleRuleAssessment`](api/motion-video-sequence.md#shutterangleruleassessment) | Type |
| [`VIDEO_FRAME_SEED_STREAM_ID`](api/motion-video-sequence.md#video_frame_seed_stream_id) | Runtime |
| [`VIDEO_FRAME_SEQUENCE_MAXIMUM_FRAMES`](api/motion-video-sequence.md#video_frame_sequence_maximum_frames) | Runtime |
| [`VIDEO_FRAME_SEQUENCE_VERSION`](api/motion-video-sequence.md#video_frame_sequence_version) | Runtime |
| [`VideoFrameSequence`](api/motion-video-sequence.md#videoframesequence) | Type |

## optics/aperture-diameter.ts

[Detailed contracts](api/optics-aperture-diameter.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/aperture-diameter.ts)

| Export | Kind |
| --- | --- |
| [`ApertureDiameter`](api/optics-aperture-diameter.md#aperturediameter) | Type |
| [`calculateApertureDiameter`](api/optics-aperture-diameter.md#calculateaperturediameter) | Runtime |
| [`CalculateApertureDiameterInput`](api/optics-aperture-diameter.md#calculateaperturediameterinput) | Type |

## optics/aperture.ts

[Detailed contracts](api/optics-aperture.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/aperture.ts)

| Export | Kind |
| --- | --- |
| [`ApertureVertex`](api/optics-aperture.md#aperturevertex) | Type |
| [`calculateIdealApertureGeometry`](api/optics-aperture.md#calculateidealaperturegeometry) | Runtime |
| [`CalculateIdealApertureInput`](api/optics-aperture.md#calculateidealapertureinput) | Type |
| [`IdealApertureGeometry`](api/optics-aperture.md#idealaperturegeometry) | Type |

## optics/atmospheric-haze.ts

[Detailed contracts](api/optics-atmospheric-haze.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/atmospheric-haze.ts)

| Export | Kind |
| --- | --- |
| [`AtmosphericExtinctionModel`](api/optics-atmospheric-haze.md#atmosphericextinctionmodel) | Type |
| [`AtmosphericHaze`](api/optics-atmospheric-haze.md#atmospherichaze) | Type |
| [`calculateAtmosphericHaze`](api/optics-atmospheric-haze.md#calculateatmospherichaze) | Runtime |
| [`CalculateAtmosphericHazeInput`](api/optics-atmospheric-haze.md#calculateatmospherichazeinput) | Type |
| [`calculateExtinctionFromVisibility`](api/optics-atmospheric-haze.md#calculateextinctionfromvisibility) | Runtime |
| [`CalculateExtinctionFromVisibilityInput`](api/optics-atmospheric-haze.md#calculateextinctionfromvisibilityinput) | Type |

## optics/brown-conrady-distortion.ts

[Detailed contracts](api/optics-brown-conrady-distortion.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/brown-conrady-distortion.ts)

| Export | Kind |
| --- | --- |
| [`BrownConradyDistortionCoefficients`](api/optics-brown-conrady-distortion.md#brownconradydistortioncoefficients) | Type |
| [`BrownConradyDistortionMapping`](api/optics-brown-conrady-distortion.md#brownconradydistortionmapping) | Type |
| [`BrownConradyDistortionProfile`](api/optics-brown-conrady-distortion.md#brownconradydistortionprofile) | Type |
| [`calculateBrownConradyDistortionMapping`](api/optics-brown-conrady-distortion.md#calculatebrownconradydistortionmapping) | Runtime |
| [`CalculateBrownConradyDistortionMappingInput`](api/optics-brown-conrady-distortion.md#calculatebrownconradydistortionmappinginput) | Type |
| [`calculateInverseBrownConradyDistortionMapping`](api/optics-brown-conrady-distortion.md#calculateinversebrownconradydistortionmapping) | Runtime |
| [`CalculateInverseBrownConradyDistortionMappingInput`](api/optics-brown-conrady-distortion.md#calculateinversebrownconradydistortionmappinginput) | Type |
| [`InverseBrownConradyDistortionMapping`](api/optics-brown-conrady-distortion.md#inversebrownconradydistortionmapping) | Type |

## optics/circle-of-confusion.ts

[Detailed contracts](api/optics-circle-of-confusion.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/circle-of-confusion.ts)

| Export | Kind |
| --- | --- |
| [`EquivalentViewingCircleOfConfusion`](api/optics-circle-of-confusion.md#equivalentviewingcircleofconfusion) | Type |
| [`estimateEquivalentViewingCircleOfConfusion`](api/optics-circle-of-confusion.md#estimateequivalentviewingcircleofconfusion) | Runtime |
| [`EstimateEquivalentViewingCircleOfConfusionInput`](api/optics-circle-of-confusion.md#estimateequivalentviewingcircleofconfusioninput) | Type |

## optics/complex-pupil-psf.ts

[Detailed contracts](api/optics-complex-pupil-psf.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/complex-pupil-psf.ts)

| Export | Kind |
| --- | --- |
| [`calculateLensComplexPupilPsf`](api/optics-complex-pupil-psf.md#calculatelenscomplexpupilpsf) | Runtime |
| [`CalculateLensComplexPupilPsfInput`](api/optics-complex-pupil-psf.md#calculatelenscomplexpupilpsfinput) | Type |
| [`LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION`](api/optics-complex-pupil-psf.md#lens_complex_pupil_profile_schema_version) | Runtime |
| [`LensComplexPupilGrid`](api/optics-complex-pupil-psf.md#lenscomplexpupilgrid) | Type |
| [`LensComplexPupilProfile`](api/optics-complex-pupil-psf.md#lenscomplexpupilprofile) | Type |
| [`LensComplexPupilPsf`](api/optics-complex-pupil-psf.md#lenscomplexpupilpsf) | Type |
| [`LensComplexPupilPsfSampling`](api/optics-complex-pupil-psf.md#lenscomplexpupilpsfsampling) | Type |
| [`parseLensComplexPupilProfile`](api/optics-complex-pupil-psf.md#parselenscomplexpupilprofile) | Runtime |

## optics/defocus-bokeh-kernel.ts

[Detailed contracts](api/optics-defocus-bokeh-kernel.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/defocus-bokeh-kernel.ts)

| Export | Kind |
| --- | --- |
| [`calculateDefocusBokehKernel`](api/optics-defocus-bokeh-kernel.md#calculatedefocusbokehkernel) | Runtime |
| [`CalculateDefocusBokehKernelInput`](api/optics-defocus-bokeh-kernel.md#calculatedefocusbokehkernelinput) | Type |
| [`DEFOCUS_BOKEH_MAXIMUM_BLADES`](api/optics-defocus-bokeh-kernel.md#defocus_bokeh_maximum_blades) | Runtime |
| [`DefocusBokehBlades`](api/optics-defocus-bokeh-kernel.md#defocusbokehblades) | Type |
| [`DefocusBokehCatsEye`](api/optics-defocus-bokeh-kernel.md#defocusbokehcatseye) | Type |
| [`DefocusBokehClippingAperture`](api/optics-defocus-bokeh-kernel.md#defocusbokehclippingaperture) | Type |
| [`DefocusBokehKernel`](api/optics-defocus-bokeh-kernel.md#defocusbokehkernel) | Type |
| [`DefocusBokehOptions`](api/optics-defocus-bokeh-kernel.md#defocusbokehoptions) | Type |
| [`DefocusBokehSphericalAberration`](api/optics-defocus-bokeh-kernel.md#defocusbokehsphericalaberration) | Type |

## optics/defocus-disc-kernel.ts

[Detailed contracts](api/optics-defocus-disc-kernel.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/defocus-disc-kernel.ts)

| Export | Kind |
| --- | --- |
| [`calculateDefocusDiscKernelRadius`](api/optics-defocus-disc-kernel.md#calculatedefocusdisckernelradius) | Runtime |
| [`CalculateDefocusDiscKernelRadiusInput`](api/optics-defocus-disc-kernel.md#calculatedefocusdisckernelradiusinput) | Type |
| [`DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES`](api/optics-defocus-disc-kernel.md#defocus_disc_kernel_maximum_radius_sites) | Runtime |
| [`DefocusDiscKernelRadius`](api/optics-defocus-disc-kernel.md#defocusdisckernelradius) | Type |

## optics/depth-of-field.ts

[Detailed contracts](api/optics-depth-of-field.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/depth-of-field.ts)

| Export | Kind |
| --- | --- |
| [`calculateDefocusCircle`](api/optics-depth-of-field.md#calculatedefocuscircle) | Runtime |
| [`CalculateDefocusCircleInput`](api/optics-depth-of-field.md#calculatedefocuscircleinput) | Type |
| [`calculateDepthOfField`](api/optics-depth-of-field.md#calculatedepthoffield) | Runtime |
| [`CalculateDepthOfFieldInput`](api/optics-depth-of-field.md#calculatedepthoffieldinput) | Type |
| [`DefocusCircle`](api/optics-depth-of-field.md#defocuscircle) | Type |
| [`DepthOfField`](api/optics-depth-of-field.md#depthoffield) | Type |

## optics/detail-limit.ts

[Detailed contracts](api/optics-detail-limit.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/detail-limit.ts)

| Export | Kind |
| --- | --- |
| [`calculateDetailLimit`](api/optics-detail-limit.md#calculatedetaillimit) | Runtime |
| [`CalculateDetailLimitInput`](api/optics-detail-limit.md#calculatedetaillimitinput) | Type |
| [`DETAIL_LIMIT_LIMITS`](api/optics-detail-limit.md#detail_limit_limits) | Runtime |
| [`DetailLimit`](api/optics-detail-limit.md#detaillimit) | Type |
| [`DetailLimitBasis`](api/optics-detail-limit.md#detaillimitbasis) | Type |
| [`DetailLimitCatalogueLens`](api/optics-detail-limit.md#detaillimitcataloguelens) | Type |
| [`DetailLimitedBy`](api/optics-detail-limit.md#detaillimitedby) | Type |
| [`DetailLimitIdealLens`](api/optics-detail-limit.md#detaillimitideallens) | Type |
| [`DetailLimitingFactor`](api/optics-detail-limit.md#detaillimitingfactor) | Type |
| [`DetailLimitOptics`](api/optics-detail-limit.md#detaillimitoptics) | Type |
| [`DetailLimitSampling`](api/optics-detail-limit.md#detaillimitsampling) | Type |
| [`DetailLimitSystem`](api/optics-detail-limit.md#detaillimitsystem) | Type |

## optics/diffraction-psf-profile.ts

[Detailed contracts](api/optics-diffraction-psf-profile.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/diffraction-psf-profile.ts)

| Export | Kind |
| --- | --- |
| [`createDiffractionLimitedPsfProfile`](api/optics-diffraction-psf-profile.md#creatediffractionlimitedpsfprofile) | Runtime |
| [`CreateDiffractionLimitedPsfProfileInput`](api/optics-diffraction-psf-profile.md#creatediffractionlimitedpsfprofileinput) | Type |
| [`DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS`](api/optics-diffraction-psf-profile.md#diffraction_limited_psf_profile_limits) | Runtime |
| [`DIFFRACTION_LIMITED_PSF_PROFILE_MODEL`](api/optics-diffraction-psf-profile.md#diffraction_limited_psf_profile_model) | Runtime |
| [`DiffractionLimitedPsfProfile`](api/optics-diffraction-psf-profile.md#diffractionlimitedpsfprofile) | Type |
| [`DiffractionLimitedPsfWavelength`](api/optics-diffraction-psf-profile.md#diffractionlimitedpsfwavelength) | Type |

## optics/diffraction.ts

[Detailed contracts](api/optics-diffraction.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/diffraction.ts)

| Export | Kind |
| --- | --- |
| [`AiryDisk`](api/optics-diffraction.md#airydisk) | Type |
| [`calculateAiryDisk`](api/optics-diffraction.md#calculateairydisk) | Runtime |
| [`CalculateAiryDiskInput`](api/optics-diffraction.md#calculateairydiskinput) | Type |

## optics/focus-breathing.ts

[Detailed contracts](api/optics-focus-breathing.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/focus-breathing.ts)

| Export | Kind |
| --- | --- |
| [`calculateFocusBreathingFieldOfView`](api/optics-focus-breathing.md#calculatefocusbreathingfieldofview) | Runtime |
| [`CalculateFocusBreathingFieldOfViewInput`](api/optics-focus-breathing.md#calculatefocusbreathingfieldofviewinput) | Type |
| [`calculateFocusBreathingProjection`](api/optics-focus-breathing.md#calculatefocusbreathingprojection) | Runtime |
| [`CalculateFocusBreathingProjectionInput`](api/optics-focus-breathing.md#calculatefocusbreathingprojectioninput) | Type |
| [`calculateGeometricFocusBreathing`](api/optics-focus-breathing.md#calculategeometricfocusbreathing) | Runtime |
| [`CalculateGeometricFocusBreathingInput`](api/optics-focus-breathing.md#calculategeometricfocusbreathinginput) | Type |
| [`FocusBreathingFieldOfView`](api/optics-focus-breathing.md#focusbreathingfieldofview) | Type |
| [`FocusBreathingProjection`](api/optics-focus-breathing.md#focusbreathingprojection) | Type |
| [`GeometricFocusBreathing`](api/optics-focus-breathing.md#geometricfocusbreathing) | Type |
| [`GeometricFocusingMethod`](api/optics-focus-breathing.md#geometricfocusingmethod) | Type |

## optics/focus-state.ts

[Detailed contracts](api/optics-focus-state.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/focus-state.ts)

| Export | Kind |
| --- | --- |
| [`calculateFocusPlaneImageDistance`](api/optics-focus-state.md#calculatefocusplaneimagedistance) | Runtime |
| [`CalculateFocusPlaneImageDistanceInput`](api/optics-focus-state.md#calculatefocusplaneimagedistanceinput) | Type |
| [`FocusPlane`](api/optics-focus-state.md#focusplane) | Type |
| [`parseFocusPlane`](api/optics-focus-state.md#parsefocusplane) | Runtime |

## optics/front-of-lens-filter.ts

[Detailed contracts](api/optics-front-of-lens-filter.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/front-of-lens-filter.ts)

| Export | Kind |
| --- | --- |
| [`ComposedFrontOfLensFilterTransmission`](api/optics-front-of-lens-filter.md#composedfrontoflensfiltertransmission) | Type |
| [`composeFrontOfLensFilterTransmission`](api/optics-front-of-lens-filter.md#composefrontoflensfiltertransmission) | Runtime |
| [`ComposeFrontOfLensFilterTransmissionInput`](api/optics-front-of-lens-filter.md#composefrontoflensfiltertransmissioninput) | Type |
| [`FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION`](api/optics-front-of-lens-filter.md#front_of_lens_filter_profile_schema_version) | Runtime |
| [`FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION`](api/optics-front-of-lens-filter.md#front_of_lens_polarizer_profile_schema_version) | Runtime |
| [`FrontOfLensFilterProfile`](api/optics-front-of-lens-filter.md#frontoflensfilterprofile) | Type |
| [`FrontOfLensFilterProfileSchemaVersion`](api/optics-front-of-lens-filter.md#frontoflensfilterprofileschemaversion) | Type |
| [`FrontOfLensFilterScientificStatus`](api/optics-front-of-lens-filter.md#frontoflensfilterscientificstatus) | Type |
| [`FrontOfLensFilterSpectralSample`](api/optics-front-of-lens-filter.md#frontoflensfilterspectralsample) | Type |
| [`FrontOfLensFilterTransmissionModel`](api/optics-front-of-lens-filter.md#frontoflensfiltertransmissionmodel) | Type |
| [`FrontOfLensFilterUncertainty`](api/optics-front-of-lens-filter.md#frontoflensfilteruncertainty) | Type |
| [`LinearPolarizationState`](api/optics-front-of-lens-filter.md#linearpolarizationstate) | Type |
| [`parseFrontOfLensFilterProfile`](api/optics-front-of-lens-filter.md#parsefrontoflensfilterprofile) | Runtime |
| [`ResolvedFrontOfLensFilterTransmission`](api/optics-front-of-lens-filter.md#resolvedfrontoflensfiltertransmission) | Type |
| [`resolveFrontOfLensFilterTransmission`](api/optics-front-of-lens-filter.md#resolvefrontoflensfiltertransmission) | Runtime |
| [`ResolveFrontOfLensFilterTransmissionInput`](api/optics-front-of-lens-filter.md#resolvefrontoflensfiltertransmissioninput) | Type |

## optics/generic-nd-filter-presets.ts

[Detailed contracts](api/optics-generic-nd-filter-presets.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/generic-nd-filter-presets.ts)

| Export | Kind |
| --- | --- |
| [`GENERIC_ND_FILTER_PROFILES`](api/optics-generic-nd-filter-presets.md#generic_nd_filter_profiles) | Runtime |
| [`GENERIC_ND_FILTER_STOPS`](api/optics-generic-nd-filter-presets.md#generic_nd_filter_stops) | Runtime |
| [`GenericNdFilterStops`](api/optics-generic-nd-filter-presets.md#genericndfilterstops) | Type |

## optics/illumination-vignetting.ts

[Detailed contracts](api/optics-illumination-vignetting.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/illumination-vignetting.ts)

| Export | Kind |
| --- | --- |
| [`calculateIlluminationVignetting`](api/optics-illumination-vignetting.md#calculateilluminationvignetting) | Runtime |
| [`CalculateIlluminationVignettingInput`](api/optics-illumination-vignetting.md#calculateilluminationvignettinginput) | Type |
| [`IlluminationVignetting`](api/optics-illumination-vignetting.md#illuminationvignetting) | Type |
| [`IlluminationVignettingCoefficients`](api/optics-illumination-vignetting.md#illuminationvignettingcoefficients) | Type |
| [`IlluminationVignettingProfile`](api/optics-illumination-vignetting.md#illuminationvignettingprofile) | Type |

## optics/irradiance-convolution.ts

[Detailed contracts](api/optics-irradiance-convolution.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/irradiance-convolution.ts)

| Export | Kind |
| --- | --- |
| [`calculateIrradianceConvolution`](api/optics-irradiance-convolution.md#calculateirradianceconvolution) | Runtime |
| [`calculateIrradianceConvolutionPlan`](api/optics-irradiance-convolution.md#calculateirradianceconvolutionplan) | Runtime |
| [`IRRADIANCE_CONVOLUTION_LIMITS`](api/optics-irradiance-convolution.md#irradiance_convolution_limits) | Runtime |
| [`IRRADIANCE_CONVOLUTION_SCHEMA_VERSION`](api/optics-irradiance-convolution.md#irradiance_convolution_schema_version) | Runtime |
| [`IrradianceConvolutionInput`](api/optics-irradiance-convolution.md#irradianceconvolutioninput) | Type |
| [`IrradianceConvolutionPlan`](api/optics-irradiance-convolution.md#irradianceconvolutionplan) | Type |

## optics/lateral-chromatic-aberration.ts

[Detailed contracts](api/optics-lateral-chromatic-aberration.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/lateral-chromatic-aberration.ts)

| Export | Kind |
| --- | --- |
| [`calculateInverseLateralChromaticAberrationMapping`](api/optics-lateral-chromatic-aberration.md#calculateinverselateralchromaticaberrationmapping) | Runtime |
| [`CalculateInverseLateralChromaticAberrationMappingInput`](api/optics-lateral-chromatic-aberration.md#calculateinverselateralchromaticaberrationmappinginput) | Type |
| [`calculateInverseLateralChromaticAberrationMappings`](api/optics-lateral-chromatic-aberration.md#calculateinverselateralchromaticaberrationmappings) | Runtime |
| [`CalculateInverseLateralChromaticAberrationMappingsInput`](api/optics-lateral-chromatic-aberration.md#calculateinverselateralchromaticaberrationmappingsinput) | Type |
| [`calculateLateralChromaticAberrationMapping`](api/optics-lateral-chromatic-aberration.md#calculatelateralchromaticaberrationmapping) | Runtime |
| [`CalculateLateralChromaticAberrationMappingInput`](api/optics-lateral-chromatic-aberration.md#calculatelateralchromaticaberrationmappinginput) | Type |
| [`ChannelSeparationVectorMm`](api/optics-lateral-chromatic-aberration.md#channelseparationvectormm) | Type |
| [`InverseLateralChromaticAberrationChannelMapping`](api/optics-lateral-chromatic-aberration.md#inverselateralchromaticaberrationchannelmapping) | Type |
| [`InverseLateralChromaticAberrationMapping`](api/optics-lateral-chromatic-aberration.md#inverselateralchromaticaberrationmapping) | Type |
| [`InverseLateralChromaticAberrationMappings`](api/optics-lateral-chromatic-aberration.md#inverselateralchromaticaberrationmappings) | Type |
| [`LateralChromaticAberrationChannel`](api/optics-lateral-chromatic-aberration.md#lateralchromaticaberrationchannel) | Type |
| [`LateralChromaticAberrationChannelMapping`](api/optics-lateral-chromatic-aberration.md#lateralchromaticaberrationchannelmapping) | Type |
| [`LateralChromaticAberrationMapping`](api/optics-lateral-chromatic-aberration.md#lateralchromaticaberrationmapping) | Type |
| [`LateralChromaticAberrationProfile`](api/optics-lateral-chromatic-aberration.md#lateralchromaticaberrationprofile) | Type |
| [`LateralChromaticAberrationSeparation`](api/optics-lateral-chromatic-aberration.md#lateralchromaticaberrationseparation) | Type |

## optics/lens-psf-kernels.ts

[Detailed contracts](api/optics-lens-psf-kernels.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/lens-psf-kernels.ts)

| Export | Kind |
| --- | --- |
| [`LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS`](api/optics-lens-psf-kernels.md#lens_psf_convolution_kernels_maximum_wavelengths) | Runtime |
| [`LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION`](api/optics-lens-psf-kernels.md#lens_psf_convolution_kernels_schema_version) | Runtime |
| [`LensPsfConvolutionKernels`](api/optics-lens-psf-kernels.md#lenspsfconvolutionkernels) | Type |
| [`LensPsfConvolutionKernelsInput`](api/optics-lens-psf-kernels.md#lenspsfconvolutionkernelsinput) | Type |
| [`resolveLensPsfConvolutionKernels`](api/optics-lens-psf-kernels.md#resolvelenspsfconvolutionkernels) | Runtime |

## optics/lens-psf-profile.ts

[Detailed contracts](api/optics-lens-psf-profile.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/lens-psf-profile.ts)

| Export | Kind |
| --- | --- |
| [`assessMtfOnlyPsfRenderability`](api/optics-lens-psf-profile.md#assessmtfonlypsfrenderability) | Runtime |
| [`LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION`](api/optics-lens-psf-profile.md#lens_mtf_diagnostic_profile_schema_version) | Runtime |
| [`LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION`](api/optics-lens-psf-profile.md#lens_sampled_psf_profile_schema_version) | Runtime |
| [`LensMtfDiagnosticProfile`](api/optics-lens-psf-profile.md#lensmtfdiagnosticprofile) | Type |
| [`LensMtfDiagnosticSample`](api/optics-lens-psf-profile.md#lensmtfdiagnosticsample) | Type |
| [`LensPsfGridAxes`](api/optics-lens-psf-profile.md#lenspsfgridaxes) | Type |
| [`LensPsfKernel`](api/optics-lens-psf-profile.md#lenspsfkernel) | Type |
| [`LensPsfScientificStatus`](api/optics-lens-psf-profile.md#lenspsfscientificstatus) | Type |
| [`LensPsfUncertainty`](api/optics-lens-psf-profile.md#lenspsfuncertainty) | Type |
| [`LensSampledPsfGridCoordinate`](api/optics-lens-psf-profile.md#lenssampledpsfgridcoordinate) | Type |
| [`LensSampledPsfGridNode`](api/optics-lens-psf-profile.md#lenssampledpsfgridnode) | Type |
| [`LensSampledPsfInterpolation`](api/optics-lens-psf-profile.md#lenssampledpsfinterpolation) | Type |
| [`LensSampledPsfProfile`](api/optics-lens-psf-profile.md#lenssampledpsfprofile) | Type |
| [`MtfOnlyPsfRenderabilityAssessment`](api/optics-lens-psf-profile.md#mtfonlypsfrenderabilityassessment) | Type |
| [`parseLensMtfDiagnosticProfile`](api/optics-lens-psf-profile.md#parselensmtfdiagnosticprofile) | Runtime |
| [`parseLensSampledPsfProfile`](api/optics-lens-psf-profile.md#parselenssampledpsfprofile) | Runtime |
| [`ResolvedLensSampledPsf`](api/optics-lens-psf-profile.md#resolvedlenssampledpsf) | Type |
| [`resolveLensSampledPsf`](api/optics-lens-psf-profile.md#resolvelenssampledpsf) | Runtime |
| [`ResolveLensSampledPsfInput`](api/optics-lens-psf-profile.md#resolvelenssampledpsfinput) | Type |

## optics/longitudinal-chromatic-aberration.ts

[Detailed contracts](api/optics-longitudinal-chromatic-aberration.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/longitudinal-chromatic-aberration.ts)

| Export | Kind |
| --- | --- |
| [`calculateCauchyRefractiveIndex`](api/optics-longitudinal-chromatic-aberration.md#calculatecauchyrefractiveindex) | Runtime |
| [`calculateLongitudinalChromaticFocus`](api/optics-longitudinal-chromatic-aberration.md#calculatelongitudinalchromaticfocus) | Runtime |
| [`CalculateLongitudinalChromaticFocusInput`](api/optics-longitudinal-chromatic-aberration.md#calculatelongitudinalchromaticfocusinput) | Type |
| [`FRAUNHOFER_C_LINE_NM`](api/optics-longitudinal-chromatic-aberration.md#fraunhofer_c_line_nm) | Runtime |
| [`FRAUNHOFER_D_LINE_NM`](api/optics-longitudinal-chromatic-aberration.md#fraunhofer_d_line_nm) | Runtime |
| [`FRAUNHOFER_F_LINE_NM`](api/optics-longitudinal-chromatic-aberration.md#fraunhofer_f_line_nm) | Runtime |
| [`LongitudinalChromaticDispersion`](api/optics-longitudinal-chromatic-aberration.md#longitudinalchromaticdispersion) | Type |
| [`LongitudinalChromaticFocus`](api/optics-longitudinal-chromatic-aberration.md#longitudinalchromaticfocus) | Type |

## optics/polygon-diffraction.ts

[Detailed contracts](api/optics-polygon-diffraction.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/polygon-diffraction.ts)

| Export | Kind |
| --- | --- |
| [`CalculateIdealPolygonDiffractionInput`](api/optics-polygon-diffraction.md#calculateidealpolygondiffractioninput) | Type |
| [`calculateIdealPolygonDiffractionPsf`](api/optics-polygon-diffraction.md#calculateidealpolygondiffractionpsf) | Runtime |
| [`calculatePolygonPupilFraunhoferPsf`](api/optics-polygon-diffraction.md#calculatepolygonpupilfraunhoferpsf) | Runtime |
| [`CalculatePolygonPupilFraunhoferPsfInput`](api/optics-polygon-diffraction.md#calculatepolygonpupilfraunhoferpsfinput) | Type |
| [`IdealPolygonDiffraction`](api/optics-polygon-diffraction.md#idealpolygondiffraction) | Type |
| [`PolygonPupilFraunhoferPsf`](api/optics-polygon-diffraction.md#polygonpupilfraunhoferpsf) | Type |

## optics/profile-contract.ts

[Detailed contracts](api/optics-profile-contract.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/profile-contract.ts)

| Export | Kind |
| --- | --- |
| [`GenericOpticalEvidence`](api/optics-profile-contract.md#genericopticalevidence) | Type |
| [`OpticalProfileState`](api/optics-profile-contract.md#opticalprofilestate) | Type |
| [`parseOpticalProfileState`](api/optics-profile-contract.md#parseopticalprofilestate) | Runtime |

## optics/psf-foundation.ts

[Detailed contracts](api/optics-psf-foundation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/psf-foundation.ts)

| Export | Kind |
| --- | --- |
| [`calculatePsfFoundationComponents`](api/optics-psf-foundation.md#calculatepsffoundationcomponents) | Runtime |
| [`CalculatePsfFoundationComponentsInput`](api/optics-psf-foundation.md#calculatepsffoundationcomponentsinput) | Type |
| [`getPsfFoundationContract`](api/optics-psf-foundation.md#getpsffoundationcontract) | Runtime |
| [`PSF_FOUNDATION_VERSION`](api/optics-psf-foundation.md#psf_foundation_version) | Runtime |
| [`PsfContributionContract`](api/optics-psf-foundation.md#psfcontributioncontract) | Type |
| [`PsfContributionId`](api/optics-psf-foundation.md#psfcontributionid) | Type |
| [`PsfContributionStatus`](api/optics-psf-foundation.md#psfcontributionstatus) | Type |
| [`PsfFoundationComponents`](api/optics-psf-foundation.md#psffoundationcomponents) | Type |
| [`PsfFoundationContract`](api/optics-psf-foundation.md#psffoundationcontract) | Type |

## optics/pupil-vignetting.ts

[Detailed contracts](api/optics-pupil-vignetting.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/pupil-vignetting.ts)

| Export | Kind |
| --- | --- |
| [`calculateMechanicalVignetting`](api/optics-pupil-vignetting.md#calculatemechanicalvignetting) | Runtime |
| [`CalculateMechanicalVignettingInput`](api/optics-pupil-vignetting.md#calculatemechanicalvignettinginput) | Type |
| [`calculateNaturalVignetting`](api/optics-pupil-vignetting.md#calculatenaturalvignetting) | Runtime |
| [`CalculateNaturalVignettingInput`](api/optics-pupil-vignetting.md#calculatenaturalvignettinginput) | Type |
| [`MechanicalVignetting`](api/optics-pupil-vignetting.md#mechanicalvignetting) | Type |
| [`MechanicalVignettingAperture`](api/optics-pupil-vignetting.md#mechanicalvignettingaperture) | Type |
| [`NaturalVignetting`](api/optics-pupil-vignetting.md#naturalvignetting) | Type |
| [`NaturalVignettingModel`](api/optics-pupil-vignetting.md#naturalvignettingmodel) | Type |

## optics/radial-distortion.ts

[Detailed contracts](api/optics-radial-distortion.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/radial-distortion.ts)

| Export | Kind |
| --- | --- |
| [`calculateInverseRadialDistortionMapping`](api/optics-radial-distortion.md#calculateinverseradialdistortionmapping) | Runtime |
| [`CalculateInverseRadialDistortionMappingInput`](api/optics-radial-distortion.md#calculateinverseradialdistortionmappinginput) | Type |
| [`calculateInverseRadialDistortionMappings`](api/optics-radial-distortion.md#calculateinverseradialdistortionmappings) | Runtime |
| [`CalculateInverseRadialDistortionMappingsInput`](api/optics-radial-distortion.md#calculateinverseradialdistortionmappingsinput) | Type |
| [`calculateRadialDistortionMapping`](api/optics-radial-distortion.md#calculateradialdistortionmapping) | Runtime |
| [`CalculateRadialDistortionMappingInput`](api/optics-radial-distortion.md#calculateradialdistortionmappinginput) | Type |
| [`InverseRadialDistortionMapping`](api/optics-radial-distortion.md#inverseradialdistortionmapping) | Type |
| [`InverseRadialDistortionMappings`](api/optics-radial-distortion.md#inverseradialdistortionmappings) | Type |
| [`LensFieldPointMm`](api/optics-radial-distortion.md#lensfieldpointmm) | Type |
| [`RadialDistortionCoefficients`](api/optics-radial-distortion.md#radialdistortioncoefficients) | Type |
| [`RadialDistortionMapping`](api/optics-radial-distortion.md#radialdistortionmapping) | Type |
| [`RadialDistortionProfile`](api/optics-radial-distortion.md#radialdistortionprofile) | Type |

## optics/scene-to-sensor-irradiance.ts

[Detailed contracts](api/optics-scene-to-sensor-irradiance.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/scene-to-sensor-irradiance.ts)

| Export | Kind |
| --- | --- |
| [`calculateSceneRadianceToSensorIrradiance`](api/optics-scene-to-sensor-irradiance.md#calculatesceneradiancetosensorirradiance) | Runtime |
| [`CalculateSceneRadianceToSensorIrradianceInput`](api/optics-scene-to-sensor-irradiance.md#calculatesceneradiancetosensorirradianceinput) | Type |
| [`NumericRange`](api/optics-scene-to-sensor-irradiance.md#numericrange) | Type |
| [`OpticalBridgeFieldThroughput`](api/optics-scene-to-sensor-irradiance.md#opticalbridgefieldthroughput) | Type |
| [`OpticalBridgeFocusApplicability`](api/optics-scene-to-sensor-irradiance.md#opticalbridgefocusapplicability) | Type |
| [`OpticalBridgeFocusContext`](api/optics-scene-to-sensor-irradiance.md#opticalbridgefocuscontext) | Type |
| [`OpticalBridgeScientificStatus`](api/optics-scene-to-sensor-irradiance.md#opticalbridgescientificstatus) | Type |
| [`OpticalBridgeUncertainty`](api/optics-scene-to-sensor-irradiance.md#opticalbridgeuncertainty) | Type |
| [`OpticalTransmissionModel`](api/optics-scene-to-sensor-irradiance.md#opticaltransmissionmodel) | Type |
| [`parseSceneToSensorIrradianceProfile`](api/optics-scene-to-sensor-irradiance.md#parsescenetosensorirradianceprofile) | Runtime |
| [`SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION`](api/optics-scene-to-sensor-irradiance.md#scene_to_sensor_irradiance_profile_schema_version) | Runtime |
| [`SceneToSensorIrradianceProfile`](api/optics-scene-to-sensor-irradiance.md#scenetosensorirradianceprofile) | Type |
| [`SceneToSensorIrradianceResult`](api/optics-scene-to-sensor-irradiance.md#scenetosensorirradianceresult) | Type |
| [`SpectralTransmissionSample`](api/optics-scene-to-sensor-irradiance.md#spectraltransmissionsample) | Type |

## optics/scene-to-sensor-quadrature.ts

[Detailed contracts](api/optics-scene-to-sensor-quadrature.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/scene-to-sensor-quadrature.ts)

| Export | Kind |
| --- | --- |
| [`calculateSceneToSensorIrradianceQuadrature`](api/optics-scene-to-sensor-quadrature.md#calculatescenetosensorirradiancequadrature) | Runtime |
| [`CalculateSceneToSensorIrradianceQuadratureInput`](api/optics-scene-to-sensor-quadrature.md#calculatescenetosensorirradiancequadratureinput) | Type |
| [`SceneSensorQuadratureSample`](api/optics-scene-to-sensor-quadrature.md#scenesensorquadraturesample) | Type |
| [`SceneToSensorIrradianceQuadrature`](api/optics-scene-to-sensor-quadrature.md#scenetosensorirradiancequadrature) | Type |

## optics/sensor-aperture-rays.ts

[Detailed contracts](api/optics-sensor-aperture-rays.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/sensor-aperture-rays.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorApertureRays`](api/optics-sensor-aperture-rays.md#calculatesensoraperturerays) | Runtime |
| [`CalculateSensorApertureRaysInput`](api/optics-sensor-aperture-rays.md#calculatesensorapertureraysinput) | Type |
| [`IdealCircularPupil`](api/optics-sensor-aperture-rays.md#idealcircularpupil) | Type |
| [`SensorApertureRay`](api/optics-sensor-aperture-rays.md#sensorapertureray) | Type |
| [`SensorApertureRays`](api/optics-sensor-aperture-rays.md#sensoraperturerays) | Type |

## optics/sensor-environment-query.ts

[Detailed contracts](api/optics-sensor-environment-query.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/sensor-environment-query.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorEnvironmentRadianceQuery`](api/optics-sensor-environment-query.md#calculatesensorenvironmentradiancequery) | Runtime |
| [`CalculateSensorEnvironmentRadianceQueryInput`](api/optics-sensor-environment-query.md#calculatesensorenvironmentradiancequeryinput) | Type |
| [`EnvironmentLensFieldMapping`](api/optics-sensor-environment-query.md#environmentlensfieldmapping) | Type |
| [`SensorEnvironmentLensFieldMappingResult`](api/optics-sensor-environment-query.md#sensorenvironmentlensfieldmappingresult) | Type |
| [`SensorEnvironmentRadianceQuery`](api/optics-sensor-environment-query.md#sensorenvironmentradiancequery) | Type |

## optics/sensor-psf-quadrature.ts

[Detailed contracts](api/optics-sensor-psf-quadrature.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/sensor-psf-quadrature.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorPsfIrradianceQuadrature`](api/optics-sensor-psf-quadrature.md#calculatesensorpsfirradiancequadrature) | Runtime |
| [`CalculateSensorPsfIrradianceQuadratureInput`](api/optics-sensor-psf-quadrature.md#calculatesensorpsfirradiancequadratureinput) | Type |
| [`SensorPsfIrradianceQuadrature`](api/optics-sensor-psf-quadrature.md#sensorpsfirradiancequadrature) | Type |
| [`SensorPsfSourceSample`](api/optics-sensor-psf-quadrature.md#sensorpsfsourcesample) | Type |

## optics/stray-light.ts

[Detailed contracts](api/optics-stray-light.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/stray-light.ts)

| Export | Kind |
| --- | --- |
| [`calculateLensStrayLightIrradiance`](api/optics-stray-light.md#calculatelensstraylightirradiance) | Runtime |
| [`LensStrayLightProfile`](api/optics-stray-light.md#lensstraylightprofile) | Type |
| [`ParametricStrayLightResponse`](api/optics-stray-light.md#parametricstraylightresponse) | Type |
| [`parseLensStrayLightProfile`](api/optics-stray-light.md#parselensstraylightprofile) | Runtime |
| [`StrayLightIrradiance`](api/optics-stray-light.md#straylightirradiance) | Type |
| [`StrayLightSource`](api/optics-stray-light.md#straylightsource) | Type |

## optics/thin-lens.ts

[Detailed contracts](api/optics-thin-lens.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/thin-lens.ts)

| Export | Kind |
| --- | --- |
| [`calculateThinLensImageDistance`](api/optics-thin-lens.md#calculatethinlensimagedistance) | Runtime |
| [`CalculateThinLensImageDistanceInput`](api/optics-thin-lens.md#calculatethinlensimagedistanceinput) | Type |
| [`ThinLensImageDistance`](api/optics-thin-lens.md#thinlensimagedistance) | Type |

## optics/zernike-wavefront.ts

[Detailed contracts](api/optics-zernike-wavefront.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/optics/zernike-wavefront.ts)

| Export | Kind |
| --- | --- |
| [`calculateDefocusWavefront`](api/optics-zernike-wavefront.md#calculatedefocuswavefront) | Runtime |
| [`CalculateDefocusWavefrontInput`](api/optics-zernike-wavefront.md#calculatedefocuswavefrontinput) | Type |
| [`createWavefrontPupilGrid`](api/optics-zernike-wavefront.md#createwavefrontpupilgrid) | Runtime |
| [`CreateWavefrontPupilGridInput`](api/optics-zernike-wavefront.md#createwavefrontpupilgridinput) | Type |
| [`DefocusWavefront`](api/optics-zernike-wavefront.md#defocuswavefront) | Type |
| [`estimateMarechalStrehlRatio`](api/optics-zernike-wavefront.md#estimatemarechalstrehlratio) | Runtime |
| [`EstimateMarechalStrehlRatioInput`](api/optics-zernike-wavefront.md#estimatemarechalstrehlratioinput) | Type |
| [`evaluateZernikePolynomial`](api/optics-zernike-wavefront.md#evaluatezernikepolynomial) | Runtime |
| [`resolveZernikeNollOrder`](api/optics-zernike-wavefront.md#resolvezernikenollorder) | Runtime |
| [`SeidelFieldPosition`](api/optics-zernike-wavefront.md#seidelfieldposition) | Type |
| [`SeidelWavefrontCoefficients`](api/optics-zernike-wavefront.md#seidelwavefrontcoefficients) | Type |
| [`WavefrontPupilGrid`](api/optics-zernike-wavefront.md#wavefrontpupilgrid) | Type |
| [`ZERNIKE_MAXIMUM_NOLL_INDEX`](api/optics-zernike-wavefront.md#zernike_maximum_noll_index) | Runtime |
| [`ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS`](api/optics-zernike-wavefront.md#zernike_pupil_maximum_samples_across) | Runtime |
| [`ZernikeCoefficient`](api/optics-zernike-wavefront.md#zernikecoefficient) | Type |
| [`ZernikeOrder`](api/optics-zernike-wavefront.md#zernikeorder) | Type |

## output/capture-corrected-sdr.ts

[Detailed contracts](api/output-capture-corrected-sdr.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/capture-corrected-sdr.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureCorrectedSdr`](api/output-capture-corrected-sdr.md#calculatecapturecorrectedsdr) | Runtime |
| [`CAPTURE_CORRECTED_SDR_SCHEMA_VERSION`](api/output-capture-corrected-sdr.md#capture_corrected_sdr_schema_version) | Runtime |
| [`CaptureCorrectedSdrInput`](api/output-capture-corrected-sdr.md#capturecorrectedsdrinput) | Type |
| [`CaptureCorrectedSdrResult`](api/output-capture-corrected-sdr.md#capturecorrectedsdrresult) | Type |
| [`parseCaptureCorrectedSdrInput`](api/output-capture-corrected-sdr.md#parsecapturecorrectedsdrinput) | Runtime |

## output/capture-geometry.ts

[Detailed contracts](api/output-capture-geometry.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/capture-geometry.ts)

| Export | Kind |
| --- | --- |
| [`ActiveCaptureFieldOfView`](api/output-capture-geometry.md#activecapturefieldofview) | Type |
| [`calculateActiveCaptureFieldOfView`](api/output-capture-geometry.md#calculateactivecapturefieldofview) | Runtime |
| [`CalculateActiveCaptureFieldOfViewInput`](api/output-capture-geometry.md#calculateactivecapturefieldofviewinput) | Type |
| [`calculateOutputFieldOfView`](api/output-capture-geometry.md#calculateoutputfieldofview) | Runtime |
| [`CalculateOutputFieldOfViewInput`](api/output-capture-geometry.md#calculateoutputfieldofviewinput) | Type |
| [`CaptureOrientation`](api/output-capture-geometry.md#captureorientation) | Type |
| [`ImagePlaneMetricPointMm`](api/output-capture-geometry.md#imageplanemetricpointmm) | Type |
| [`mapImagePlanePointToOrientedPhysicalUv`](api/output-capture-geometry.md#mapimageplanepointtoorientedphysicaluv) | Runtime |
| [`MapImagePlanePointToOrientedPhysicalUvInput`](api/output-capture-geometry.md#mapimageplanepointtoorientedphysicaluvinput) | Type |
| [`MapOrientedPhysicalUvToImagePlaneInput`](api/output-capture-geometry.md#maporientedphysicaluvtoimageplaneinput) | Type |
| [`mapOrientedPhysicalUvToImagePlanePoint`](api/output-capture-geometry.md#maporientedphysicaluvtoimageplanepoint) | Runtime |
| [`NormalizedRasterUv`](api/output-capture-geometry.md#normalizedrasteruv) | Type |
| [`OutputFieldOfView`](api/output-capture-geometry.md#outputfieldofview) | Type |
| [`PhysicalBoundsFromOpticalAxisMm`](api/output-capture-geometry.md#physicalboundsfromopticalaxismm) | Type |
| [`RasterPoint`](api/output-capture-geometry.md#rasterpoint) | Type |
| [`RasterRect`](api/output-capture-geometry.md#rasterrect) | Type |
| [`RasterVector`](api/output-capture-geometry.md#rastervector) | Type |
| [`resolveCaptureGeometry`](api/output-capture-geometry.md#resolvecapturegeometry) | Runtime |
| [`ResolveCaptureGeometryInput`](api/output-capture-geometry.md#resolvecapturegeometryinput) | Type |
| [`ResolvedCaptureGeometry`](api/output-capture-geometry.md#resolvedcapturegeometry) | Type |
| [`transformNativeRasterPointToOriented`](api/output-capture-geometry.md#transformnativerasterpointtooriented) | Runtime |
| [`transformNativeRasterRectToOriented`](api/output-capture-geometry.md#transformnativerasterrecttooriented) | Runtime |
| [`transformNativeRasterVectorToOriented`](api/output-capture-geometry.md#transformnativerastervectortooriented) | Runtime |
| [`transformOrientedRasterPointToNative`](api/output-capture-geometry.md#transformorientedrasterpointtonative) | Runtime |
| [`transformOrientedRasterRectToNative`](api/output-capture-geometry.md#transformorientedrasterrecttonative) | Runtime |
| [`transformOrientedRasterVectorToNative`](api/output-capture-geometry.md#transformorientedrastervectortonative) | Runtime |
| [`TransformRasterPointInput`](api/output-capture-geometry.md#transformrasterpointinput) | Type |
| [`TransformRasterRectInput`](api/output-capture-geometry.md#transformrasterrectinput) | Type |
| [`TransformRasterVectorInput`](api/output-capture-geometry.md#transformrastervectorinput) | Type |

## output/capture-sdr.ts

[Detailed contracts](api/output-capture-sdr.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/capture-sdr.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureSdr`](api/output-capture-sdr.md#calculatecapturesdr) | Runtime |
| [`CAPTURE_SDR_SCHEMA_VERSION`](api/output-capture-sdr.md#capture_sdr_schema_version) | Runtime |
| [`CaptureSdrInput`](api/output-capture-sdr.md#capturesdrinput) | Type |
| [`CaptureSdrResult`](api/output-capture-sdr.md#capturesdrresult) | Type |
| [`parseCaptureSdrInput`](api/output-capture-sdr.md#parsecapturesdrinput) | Runtime |

## output/crop-to-match-focal-length.ts

[Detailed contracts](api/output-crop-to-match-focal-length.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/crop-to-match-focal-length.ts)

| Export | Kind |
| --- | --- |
| [`calculateCropToMatchFocalLength`](api/output-crop-to-match-focal-length.md#calculatecroptomatchfocallength) | Runtime |
| [`CalculateCropToMatchFocalLengthInput`](api/output-crop-to-match-focal-length.md#calculatecroptomatchfocallengthinput) | Type |
| [`CropToMatchFocalLength`](api/output-crop-to-match-focal-length.md#croptomatchfocallength) | Type |

## output/crop.ts

[Detailed contracts](api/output-crop.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/crop.ts)

| Export | Kind |
| --- | --- |
| [`calculateCenteredCrop`](api/output-crop.md#calculatecenteredcrop) | Runtime |
| [`CalculateCenteredCropInput`](api/output-crop.md#calculatecenteredcropinput) | Type |
| [`CenteredCrop`](api/output-crop.md#centeredcrop) | Type |

## output/developed-lens-corrections.ts

[Detailed contracts](api/output-developed-lens-corrections.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/developed-lens-corrections.ts)

| Export | Kind |
| --- | --- |
| [`GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM`](api/output-developed-lens-corrections.md#generic_lens_correction_channel_wavelengths_nm) | Runtime |

## output/generic-lens-corrections.ts

[Detailed contracts](api/output-generic-lens-corrections.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/generic-lens-corrections.ts)

| Export | Kind |
| --- | --- |
| [`createGenericLensCorrectionProfile`](api/output-generic-lens-corrections.md#creategenericlenscorrectionprofile) | Runtime |
| [`CreateGenericLensCorrectionProfileInput`](api/output-generic-lens-corrections.md#creategenericlenscorrectionprofileinput) | Type |

## output/geometric-transforms.ts

[Detailed contracts](api/output-geometric-transforms.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/geometric-transforms.ts)

| Export | Kind |
| --- | --- |
| [`AffineGeometricTransform`](api/output-geometric-transforms.md#affinegeometrictransform) | Type |
| [`BrownConradyGeometricTransform`](api/output-geometric-transforms.md#brownconradygeometrictransform) | Type |
| [`calculateComposedGeometricMapping`](api/output-geometric-transforms.md#calculatecomposedgeometricmapping) | Runtime |
| [`calculateForwardGeometricMapping`](api/output-geometric-transforms.md#calculateforwardgeometricmapping) | Runtime |
| [`calculateGeometricResampling`](api/output-geometric-transforms.md#calculategeometricresampling) | Runtime |
| [`calculateGeometricSamplingPlan`](api/output-geometric-transforms.md#calculategeometricsamplingplan) | Runtime |
| [`DigitalGeometricTransform`](api/output-geometric-transforms.md#digitalgeometrictransform) | Type |
| [`GeometricImageDomain`](api/output-geometric-transforms.md#geometricimagedomain) | Type |
| [`GeometricJacobian`](api/output-geometric-transforms.md#geometricjacobian) | Type |
| [`GeometricMappingPoint`](api/output-geometric-transforms.md#geometricmappingpoint) | Type |
| [`GeometricProjectionDeclaration`](api/output-geometric-transforms.md#geometricprojectiondeclaration) | Type |
| [`GeometricRaster`](api/output-geometric-transforms.md#geometricraster) | Type |
| [`GeometricResampler`](api/output-geometric-transforms.md#geometricresampler) | Type |
| [`GeometricSamplingPlan`](api/output-geometric-transforms.md#geometricsamplingplan) | Type |
| [`parseDigitalGeometricTransform`](api/output-geometric-transforms.md#parsedigitalgeometrictransform) | Runtime |
| [`PreparedGeometricMapping`](api/output-geometric-transforms.md#preparedgeometricmapping) | Type |
| [`prepareGeometricMapping`](api/output-geometric-transforms.md#preparegeometricmapping) | Runtime |
| [`ProjectionRemapGeometricTransform`](api/output-geometric-transforms.md#projectionremapgeometrictransform) | Type |
| [`RadialGeometricTransform`](api/output-geometric-transforms.md#radialgeometrictransform) | Type |

## output/lens-corrections.ts

[Detailed contracts](api/output-lens-corrections.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/lens-corrections.ts)

| Export | Kind |
| --- | --- |
| [`calculateLensCorrectedCapture`](api/output-lens-corrections.md#calculatelenscorrectedcapture) | Runtime |
| [`calculatePeripheralIlluminationCorrection`](api/output-lens-corrections.md#calculateperipheralilluminationcorrection) | Runtime |
| [`GenericLensCorrectionProfile`](api/output-lens-corrections.md#genericlenscorrectionprofile) | Type |
| [`GeometricLensCorrection`](api/output-lens-corrections.md#geometriclenscorrection) | Type |
| [`IlluminationLensCorrection`](api/output-lens-corrections.md#illuminationlenscorrection) | Type |
| [`LateralCaLensCorrection`](api/output-lens-corrections.md#lateralcalenscorrection) | Type |
| [`LensCorrectionCapture`](api/output-lens-corrections.md#lenscorrectioncapture) | Type |
| [`LensCorrectionChannel`](api/output-lens-corrections.md#lenscorrectionchannel) | Type |
| [`LensCorrectionComponent`](api/output-lens-corrections.md#lenscorrectioncomponent) | Type |
| [`parseGenericLensCorrectionProfile`](api/output-lens-corrections.md#parsegenericlenscorrectionprofile) | Runtime |
| [`ResolvedLensCorrectionPlan`](api/output-lens-corrections.md#resolvedlenscorrectionplan) | Type |
| [`resolveLensCorrectionPlan`](api/output-lens-corrections.md#resolvelenscorrectionplan) | Runtime |

## output/native-capture-sdr.ts

[Detailed contracts](api/output-native-capture-sdr.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/native-capture-sdr.ts)

| Export | Kind |
| --- | --- |
| [`calculateNativeCaptureSdrPlan`](api/output-native-capture-sdr.md#calculatenativecapturesdrplan) | Runtime |
| [`createNativeCaptureSdrTask`](api/output-native-capture-sdr.md#createnativecapturesdrtask) | Runtime |
| [`NATIVE_CAPTURE_SDR_LIMITS`](api/output-native-capture-sdr.md#native_capture_sdr_limits) | Runtime |
| [`NATIVE_CAPTURE_SDR_SCHEMA_VERSION`](api/output-native-capture-sdr.md#native_capture_sdr_schema_version) | Runtime |
| [`NativeCaptureSdrInput`](api/output-native-capture-sdr.md#nativecapturesdrinput) | Type |
| [`NativeCaptureSdrOutput`](api/output-native-capture-sdr.md#nativecapturesdroutput) | Type |
| [`NativeCaptureSdrPlan`](api/output-native-capture-sdr.md#nativecapturesdrplan) | Type |
| [`NativeCaptureSdrProvider`](api/output-native-capture-sdr.md#nativecapturesdrprovider) | Type |
| [`NativeCaptureSdrTask`](api/output-native-capture-sdr.md#nativecapturesdrtask) | Type |
| [`NativeCaptureSdrTaskState`](api/output-native-capture-sdr.md#nativecapturesdrtaskstate) | Type |
| [`NativeCaptureSdrTile`](api/output-native-capture-sdr.md#nativecapturesdrtile) | Type |
| [`NativeCaptureSdrTileRequest`](api/output-native-capture-sdr.md#nativecapturesdrtilerequest) | Type |
| [`NativeTaskProgress`](api/output-native-capture-sdr.md#nativetaskprogress) | Type |

## output/png-encoder.ts

[Detailed contracts](api/output-png-encoder.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/png-encoder.ts)

| Export | Kind |
| --- | --- |
| [`PNG_ENCODER_ID`](api/output-png-encoder.md#png_encoder_id) | Runtime |
| [`PNG_ENCODER_LIMITS`](api/output-png-encoder.md#png_encoder_limits) | Runtime |
| [`PngCicpPrimaries`](api/output-png-encoder.md#pngcicpprimaries) | Type |
| [`PngCicpTransfer`](api/output-png-encoder.md#pngcicptransfer) | Type |
| [`PngColourEncoding`](api/output-png-encoder.md#pngcolourencoding) | Type |
| [`PngContentLightLevel`](api/output-png-encoder.md#pngcontentlightlevel) | Type |
| [`PngEncodeInput`](api/output-png-encoder.md#pngencodeinput) | Type |
| [`PngMasteringDisplay`](api/output-png-encoder.md#pngmasteringdisplay) | Type |
| [`serializePngImage`](api/output-png-encoder.md#serializepngimage) | Runtime |

## output/print-contrast-reference.ts

[Detailed contracts](api/output-print-contrast-reference.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/print-contrast-reference.ts)

| Export | Kind |
| --- | --- |
| [`calculatePrintContrastReference`](api/output-print-contrast-reference.md#calculateprintcontrastreference) | Runtime |
| [`parsePrintContrastReferenceInput`](api/output-print-contrast-reference.md#parseprintcontrastreferenceinput) | Runtime |
| [`PRINT_CONTRAST_REFERENCE_MODEL_VERSION`](api/output-print-contrast-reference.md#print_contrast_reference_model_version) | Runtime |
| [`PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION`](api/output-print-contrast-reference.md#print_contrast_reference_upstream_revision) | Runtime |
| [`PrintContrastReference`](api/output-print-contrast-reference.md#printcontrastreference) | Type |
| [`PrintContrastReferenceInput`](api/output-print-contrast-reference.md#printcontrastreferenceinput) | Type |

## output/print-detail.ts

[Detailed contracts](api/output-print-detail.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/print-detail.ts)

| Export | Kind |
| --- | --- |
| [`calculatePrintRegionDetail`](api/output-print-detail.md#calculateprintregiondetail) | Runtime |
| [`MAX_PRINT_DETAIL_REGION_SAMPLES`](api/output-print-detail.md#max_print_detail_region_samples) | Runtime |
| [`parsePrintRegionDetailInput`](api/output-print-detail.md#parseprintregiondetailinput) | Runtime |
| [`PRINT_REGION_DETAIL_MODEL_VERSION`](api/output-print-detail.md#print_region_detail_model_version) | Runtime |
| [`PrintDetailRegion`](api/output-print-detail.md#printdetailregion) | Type |
| [`PrintDetailSource`](api/output-print-detail.md#printdetailsource) | Type |
| [`PrintRegionDetailAssessment`](api/output-print-detail.md#printregiondetailassessment) | Type |
| [`PrintRegionDetailInput`](api/output-print-detail.md#printregiondetailinput) | Type |
| [`PrintSinusoidalMeasurement`](api/output-print-detail.md#printsinusoidalmeasurement) | Type |
| [`PrintSinusoidalTarget`](api/output-print-detail.md#printsinusoidaltarget) | Type |

## output/print-jpeg.ts

[Detailed contracts](api/output-print-jpeg.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/print-jpeg.ts)

| Export | Kind |
| --- | --- |
| [`composePrintJpegStrips`](api/output-print-jpeg.md#composeprintjpegstrips) | Runtime |
| [`createPrintJpegStrip`](api/output-print-jpeg.md#createprintjpegstrip) | Runtime |
| [`createPrintJpegTask`](api/output-print-jpeg.md#createprintjpegtask) | Runtime |
| [`parsePrintJpegInput`](api/output-print-jpeg.md#parseprintjpeginput) | Runtime |
| [`PRINT_JPEG_LIMITS`](api/output-print-jpeg.md#print_jpeg_limits) | Runtime |
| [`PRINT_JPEG_SCHEMA_VERSION`](api/output-print-jpeg.md#print_jpeg_schema_version) | Runtime |
| [`PrintJpegInput`](api/output-print-jpeg.md#printjpeginput) | Type |
| [`PrintJpegOutput`](api/output-print-jpeg.md#printjpegoutput) | Type |
| [`PrintJpegProvider`](api/output-print-jpeg.md#printjpegprovider) | Type |
| [`PrintJpegSource`](api/output-print-jpeg.md#printjpegsource) | Type |
| [`PrintJpegStrip`](api/output-print-jpeg.md#printjpegstrip) | Type |
| [`PrintJpegStripInput`](api/output-print-jpeg.md#printjpegstripinput) | Type |
| [`PrintJpegTask`](api/output-print-jpeg.md#printjpegtask) | Type |
| [`PrintJpegTile`](api/output-print-jpeg.md#printjpegtile) | Type |
| [`PrintJpegTileRequest`](api/output-print-jpeg.md#printjpegtilerequest) | Type |

## output/print-plan.ts

[Detailed contracts](api/output-print-plan.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/print-plan.ts)

| Export | Kind |
| --- | --- |
| [`calculatePrintPlan`](api/output-print-plan.md#calculateprintplan) | Runtime |
| [`calculatePrintSizeLimit`](api/output-print-plan.md#calculateprintsizelimit) | Runtime |
| [`parsePrintPlanInput`](api/output-print-plan.md#parseprintplaninput) | Runtime |
| [`PrintedImageSize`](api/output-print-plan.md#printedimagesize) | Type |
| [`PrintLength`](api/output-print-plan.md#printlength) | Type |
| [`PrintNativeSource`](api/output-print-plan.md#printnativesource) | Type |
| [`PrintPlan`](api/output-print-plan.md#printplan) | Type |
| [`PrintPlanInput`](api/output-print-plan.md#printplaninput) | Type |
| [`PrintProviderConstraints`](api/output-print-plan.md#printproviderconstraints) | Type |
| [`PrintRasterSampling`](api/output-print-plan.md#printrastersampling) | Type |
| [`PrintSamplingCriterion`](api/output-print-plan.md#printsamplingcriterion) | Type |
| [`PrintSizeLimit`](api/output-print-plan.md#printsizelimit) | Type |
| [`PrintSizeLimitInput`](api/output-print-plan.md#printsizelimitinput) | Type |

## output/print-region-statistics.ts

[Detailed contracts](api/output-print-region-statistics.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/print-region-statistics.ts)

| Export | Kind |
| --- | --- |
| [`calculatePrintRegionDifference`](api/output-print-region-statistics.md#calculateprintregiondifference) | Runtime |
| [`calculatePrintRegionNoise`](api/output-print-region-statistics.md#calculateprintregionnoise) | Runtime |
| [`MAX_PRINT_REGION_STATISTICS_SAMPLES`](api/output-print-region-statistics.md#max_print_region_statistics_samples) | Runtime |
| [`parsePrintRegionDifferenceInput`](api/output-print-region-statistics.md#parseprintregiondifferenceinput) | Runtime |
| [`parsePrintRegionNoiseInput`](api/output-print-region-statistics.md#parseprintregionnoiseinput) | Runtime |
| [`PRINT_REGION_STATISTICS_MODEL_VERSION`](api/output-print-region-statistics.md#print_region_statistics_model_version) | Runtime |
| [`PrintRegionDifferenceInput`](api/output-print-region-statistics.md#printregiondifferenceinput) | Type |
| [`PrintRegionDifferenceMeasurement`](api/output-print-region-statistics.md#printregiondifferencemeasurement) | Type |
| [`PrintRegionNoiseInput`](api/output-print-region-statistics.md#printregionnoiseinput) | Type |
| [`PrintRegionNoiseMeasurement`](api/output-print-region-statistics.md#printregionnoisemeasurement) | Type |
| [`PrintRegionRaster`](api/output-print-region-statistics.md#printregionraster) | Type |
| [`PrintRegionStatisticsAssessment`](api/output-print-region-statistics.md#printregionstatisticsassessment) | Type |

## output/print-size-blur-noise.ts

[Detailed contracts](api/output-print-size-blur-noise.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/print-size-blur-noise.ts)

| Export | Kind |
| --- | --- |
| [`calculatePrintSizeLimitWithBlurAndNoise`](api/output-print-size-blur-noise.md#calculateprintsizelimitwithblurandnoise) | Runtime |
| [`PrintBlurInput`](api/output-print-size-blur-noise.md#printblurinput) | Type |
| [`PrintImageMm`](api/output-print-size-blur-noise.md#printimagemm) | Type |
| [`PrintNoiseInput`](api/output-print-size-blur-noise.md#printnoiseinput) | Type |
| [`PrintSharpCleanCriterion`](api/output-print-size-blur-noise.md#printsharpcleancriterion) | Type |
| [`PrintSizeLimitWithBlurAndNoise`](api/output-print-size-blur-noise.md#printsizelimitwithblurandnoise) | Type |
| [`PrintSizeLimitWithBlurAndNoiseInput`](api/output-print-size-blur-noise.md#printsizelimitwithblurandnoiseinput) | Type |

## output/sdr-rendering.ts

[Detailed contracts](api/output-sdr-rendering.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/sdr-rendering.ts)

| Export | Kind |
| --- | --- |
| [`calculateSdrRendering`](api/output-sdr-rendering.md#calculatesdrrendering) | Runtime |
| [`parseSdrRenderingInput`](api/output-sdr-rendering.md#parsesdrrenderinginput) | Runtime |
| [`parseSdrRenderingProfile`](api/output-sdr-rendering.md#parsesdrrenderingprofile) | Runtime |
| [`SDR_RENDERING_MODEL_VERSION`](api/output-sdr-rendering.md#sdr_rendering_model_version) | Runtime |
| [`SDR_RENDERING_SCHEMA_VERSION`](api/output-sdr-rendering.md#sdr_rendering_schema_version) | Runtime |
| [`SdrRenderingInput`](api/output-sdr-rendering.md#sdrrenderinginput) | Type |
| [`SdrRenderingProfile`](api/output-sdr-rendering.md#sdrrenderingprofile) | Type |
| [`SdrRenderingResult`](api/output-sdr-rendering.md#sdrrenderingresult) | Type |
| [`SdrToneCurve`](api/output-sdr-rendering.md#sdrtonecurve) | Type |
| [`SdrToneCurveParameters`](api/output-sdr-rendering.md#sdrtonecurveparameters) | Type |

## output/subject-framing-crop.ts

[Detailed contracts](api/output-subject-framing-crop.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/subject-framing-crop.ts)

| Export | Kind |
| --- | --- |
| [`calculateSubjectFramingCrop`](api/output-subject-framing-crop.md#calculatesubjectframingcrop) | Runtime |
| [`CalculateSubjectFramingCropInput`](api/output-subject-framing-crop.md#calculatesubjectframingcropinput) | Type |
| [`SubjectFramingCrop`](api/output-subject-framing-crop.md#subjectframingcrop) | Type |

## output/text-metadata.ts

[Detailed contracts](api/output-text-metadata.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/output/text-metadata.ts)

| Export | Kind |
| --- | --- |
| [`addJpegTextMetadata`](api/output-text-metadata.md#addjpegtextmetadata) | Runtime |
| [`addPngTextMetadata`](api/output-text-metadata.md#addpngtextmetadata) | Runtime |
| [`OutputTextMetadata`](api/output-text-metadata.md#outputtextmetadata) | Type |

## processing/demosaic.ts

[Detailed contracts](api/processing-demosaic.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/demosaic.ts)

| Export | Kind |
| --- | --- |
| [`AhdDemosaicInput`](api/processing-demosaic.md#ahddemosaicinput) | Type |
| [`AhdDemosaicOutput`](api/processing-demosaic.md#ahddemosaicoutput) | Type |
| [`CfaMosaicPlane`](api/processing-demosaic.md#cfamosaicplane) | Type |
| [`CfaPlaneReconstructionInput`](api/processing-demosaic.md#cfaplanereconstructioninput) | Type |
| [`CfaPlaneReconstructionOutput`](api/processing-demosaic.md#cfaplanereconstructionoutput) | Type |
| [`createAhdDemosaicTask`](api/processing-demosaic.md#createahddemosaictask) | Runtime |
| [`createCfaPlaneReconstructionTask`](api/processing-demosaic.md#createcfaplanereconstructiontask) | Runtime |

## processing/denoise.ts

[Detailed contracts](api/processing-denoise.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/denoise.ts)

| Export | Kind |
| --- | --- |
| [`BilateralFilterInput`](api/processing-denoise.md#bilateralfilterinput) | Type |
| [`createBilateralFilterTask`](api/processing-denoise.md#createbilateralfiltertask) | Runtime |
| [`createNonLocalMeansTask`](api/processing-denoise.md#createnonlocalmeanstask) | Runtime |
| [`createSyntheticFilmGrainTask`](api/processing-denoise.md#createsyntheticfilmgraintask) | Runtime |
| [`createUnsharpMaskTask`](api/processing-denoise.md#createunsharpmasktask) | Runtime |
| [`NonLocalMeansInput`](api/processing-denoise.md#nonlocalmeansinput) | Type |
| [`ProcessedRgbImage`](api/processing-denoise.md#processedrgbimage) | Type |
| [`SYNTHETIC_FILM_GRAIN_STREAM_ID`](api/processing-denoise.md#synthetic_film_grain_stream_id) | Runtime |
| [`SyntheticFilmGrainInput`](api/processing-denoise.md#syntheticfilmgraininput) | Type |
| [`SyntheticFilmGrainOutput`](api/processing-denoise.md#syntheticfilmgrainoutput) | Type |
| [`UnsharpMaskInput`](api/processing-denoise.md#unsharpmaskinput) | Type |

## processing/focus-stacking.ts

[Detailed contracts](api/processing-focus-stacking.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/focus-stacking.ts)

| Export | Kind |
| --- | --- |
| [`createFocusStackTask`](api/processing-focus-stacking.md#createfocusstacktask) | Runtime |
| [`FocusStackInput`](api/processing-focus-stacking.md#focusstackinput) | Type |
| [`FocusStackOutput`](api/processing-focus-stacking.md#focusstackoutput) | Type |

## processing/hdr.ts

[Detailed contracts](api/processing-hdr.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/hdr.ts)

| Export | Kind |
| --- | --- |
| [`createHdrBracketMergeTask`](api/processing-hdr.md#createhdrbracketmergetask) | Runtime |
| [`createHdrImageEncodingTask`](api/processing-hdr.md#createhdrimageencodingtask) | Runtime |
| [`HdrBracketFrame`](api/processing-hdr.md#hdrbracketframe) | Type |
| [`HdrBracketMergeInput`](api/processing-hdr.md#hdrbracketmergeinput) | Type |
| [`HdrBracketMergeOutput`](api/processing-hdr.md#hdrbracketmergeoutput) | Type |
| [`HdrImageEncodingInput`](api/processing-hdr.md#hdrimageencodinginput) | Type |
| [`HdrImageEncodingOutput`](api/processing-hdr.md#hdrimageencodingoutput) | Type |
| [`HdrTransfer`](api/processing-hdr.md#hdrtransfer) | Type |

## processing/panorama.ts

[Detailed contracts](api/processing-panorama.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/panorama.ts)

| Export | Kind |
| --- | --- |
| [`createPanoramaTask`](api/processing-panorama.md#createpanoramatask) | Runtime |
| [`PanoramaCanvas`](api/processing-panorama.md#panoramacanvas) | Type |
| [`PanoramaFrame`](api/processing-panorama.md#panoramaframe) | Type |
| [`PanoramaInput`](api/processing-panorama.md#panoramainput) | Type |
| [`PanoramaOutput`](api/processing-panorama.md#panoramaoutput) | Type |

## processing/processing-task.ts

[Detailed contracts](api/processing-processing-task.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/processing-task.ts)

| Export | Kind |
| --- | --- |
| [`PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES`](api/processing-processing-task.md#processing_default_maximum_working_bytes) | Runtime |
| [`PROCESSING_MAX_FRAMES`](api/processing-processing-task.md#processing_max_frames) | Runtime |
| [`PROCESSING_MAX_PIXELS`](api/processing-processing-task.md#processing_max_pixels) | Runtime |
| [`PROCESSING_MODEL_VERSION`](api/processing-processing-task.md#processing_model_version) | Runtime |
| [`ProcessingLinearColorSpace`](api/processing-processing-task.md#processinglinearcolorspace) | Type |
| [`ProcessingProvenance`](api/processing-processing-task.md#processingprovenance) | Type |
| [`ProcessingProvider`](api/processing-processing-task.md#processingprovider) | Type |
| [`ProcessingRgbImage`](api/processing-processing-task.md#processingrgbimage) | Type |
| [`ProcessingTask`](api/processing-processing-task.md#processingtask) | Type |
| [`ProcessingTaskState`](api/processing-processing-task.md#processingtaskstate) | Type |

## processing/tone-mapping.ts

[Detailed contracts](api/processing-tone-mapping.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/processing/tone-mapping.ts)

| Export | Kind |
| --- | --- |
| [`createDurandDorseyToneMappingTask`](api/processing-tone-mapping.md#createduranddorseytonemappingtask) | Runtime |
| [`createExposureFusionTask`](api/processing-tone-mapping.md#createexposurefusiontask) | Runtime |
| [`createReinhardGlobalToneMappingTask`](api/processing-tone-mapping.md#createreinhardglobaltonemappingtask) | Runtime |
| [`DurandDorseyToneMappingInput`](api/processing-tone-mapping.md#duranddorseytonemappinginput) | Type |
| [`DurandDorseyToneMappingOutput`](api/processing-tone-mapping.md#duranddorseytonemappingoutput) | Type |
| [`ExposureFusionInput`](api/processing-tone-mapping.md#exposurefusioninput) | Type |
| [`ExposureFusionOutput`](api/processing-tone-mapping.md#exposurefusionoutput) | Type |
| [`ReinhardGlobalToneMappingInput`](api/processing-tone-mapping.md#reinhardglobaltonemappinginput) | Type |
| [`ReinhardGlobalToneMappingOutput`](api/processing-tone-mapping.md#reinhardglobaltonemappingoutput) | Type |
| [`ToneMappedImage`](api/processing-tone-mapping.md#tonemappedimage) | Type |

## schema/camera.ts

[Detailed contracts](api/schema-camera.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/camera.ts)

| Export | Kind |
| --- | --- |
| [`CameraConfiguration`](api/schema-camera.md#cameraconfiguration) | Type |
| [`CameraSupport`](api/schema-camera.md#camerasupport) | Type |
| [`ExposureConfiguration`](api/schema-camera.md#exposureconfiguration) | Type |
| [`FocusConfiguration`](api/schema-camera.md#focusconfiguration) | Type |
| [`LensConfiguration`](api/schema-camera.md#lensconfiguration) | Type |
| [`SensorConfiguration`](api/schema-camera.md#sensorconfiguration) | Type |
| [`StabilizationConfiguration`](api/schema-camera.md#stabilizationconfiguration) | Type |

## schema/illumination-spectral.ts

[Detailed contracts](api/schema-illumination-spectral.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/illumination-spectral.ts)

| Export | Kind |
| --- | --- |
| [`createSceneIlluminationSpectralCoverageParticipant`](api/schema-illumination-spectral.md#createsceneilluminationspectralcoverageparticipant) | Runtime |
| [`CreateSceneIlluminationSpectralCoverageParticipantInput`](api/schema-illumination-spectral.md#createsceneilluminationspectralcoverageparticipantinput) | Type |
| [`resolveSceneIlluminationDiscreteLineMeasure`](api/schema-illumination-spectral.md#resolvesceneilluminationdiscretelinemeasure) | Runtime |
| [`SceneIlluminationDiscreteLineMeasure`](api/schema-illumination-spectral.md#sceneilluminationdiscretelinemeasure) | Type |

## schema/illumination-temporal.ts

[Detailed contracts](api/schema-illumination-temporal.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/illumination-temporal.ts)

| Export | Kind |
| --- | --- |
| [`evaluateSceneIlluminationTemporalMultiplier`](api/schema-illumination-temporal.md#evaluatesceneilluminationtemporalmultiplier) | Runtime |
| [`EvaluateSceneIlluminationTemporalMultiplierInput`](api/schema-illumination-temporal.md#evaluatesceneilluminationtemporalmultiplierinput) | Type |
| [`IntegrateSceneIlluminationTemporalMultiplierInput`](api/schema-illumination-temporal.md#integratesceneilluminationtemporalmultiplierinput) | Type |
| [`integrateSceneIlluminationTemporalMultiplierOverExposureWindow`](api/schema-illumination-temporal.md#integratesceneilluminationtemporalmultiplieroverexposurewindow) | Runtime |
| [`parseSceneIlluminationTemporalProfile`](api/schema-illumination-temporal.md#parsesceneilluminationtemporalprofile) | Runtime |
| [`SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION`](api/schema-illumination-temporal.md#scene_illumination_temporal_profile_schema_version) | Runtime |
| [`SceneIlluminationTemporalExposureIntegration`](api/schema-illumination-temporal.md#sceneilluminationtemporalexposureintegration) | Type |
| [`SceneIlluminationTemporalIntegrationNode`](api/schema-illumination-temporal.md#sceneilluminationtemporalintegrationnode) | Type |
| [`SceneIlluminationTemporalMultiplierEvaluation`](api/schema-illumination-temporal.md#sceneilluminationtemporalmultiplierevaluation) | Type |
| [`SceneIlluminationTemporalProfile`](api/schema-illumination-temporal.md#sceneilluminationtemporalprofile) | Type |
| [`SceneIlluminationTemporalRegistrationUncertainty`](api/schema-illumination-temporal.md#sceneilluminationtemporalregistrationuncertainty) | Type |
| [`SceneIlluminationTemporalScientificStatus`](api/schema-illumination-temporal.md#sceneilluminationtemporalscientificstatus) | Type |
| [`SceneIlluminationTemporalSourceBinding`](api/schema-illumination-temporal.md#sceneilluminationtemporalsourcebinding) | Type |
| [`SceneIlluminationTemporalWaveform`](api/schema-illumination-temporal.md#sceneilluminationtemporalwaveform) | Type |
| [`SceneIlluminationTemporalWaveformSample`](api/schema-illumination-temporal.md#sceneilluminationtemporalwaveformsample) | Type |

## schema/illumination.ts

[Detailed contracts](api/schema-illumination.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/illumination.ts)

| Export | Kind |
| --- | --- |
| [`parseSceneIlluminationProfile`](api/schema-illumination.md#parsesceneilluminationprofile) | Runtime |
| [`SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION`](api/schema-illumination.md#scene_illumination_profile_schema_version) | Runtime |
| [`SceneIlluminationMagnitude`](api/schema-illumination.md#sceneilluminationmagnitude) | Type |
| [`SceneIlluminationProfile`](api/schema-illumination.md#sceneilluminationprofile) | Type |
| [`SceneIlluminationRelativeSpectrumSample`](api/schema-illumination.md#sceneilluminationrelativespectrumsample) | Type |
| [`SceneIlluminationScientificStatus`](api/schema-illumination.md#sceneilluminationscientificstatus) | Type |
| [`SceneIlluminationSource`](api/schema-illumination.md#sceneilluminationsource) | Type |
| [`SceneIlluminationSourceFamily`](api/schema-illumination.md#sceneilluminationsourcefamily) | Type |
| [`SceneIlluminationSourceGeometry`](api/schema-illumination.md#sceneilluminationsourcegeometry) | Type |
| [`SceneIlluminationSpectrum`](api/schema-illumination.md#sceneilluminationspectrum) | Type |
| [`SceneIlluminationUncertainty`](api/schema-illumination.md#sceneilluminationuncertainty) | Type |

## schema/scene-radiance-temporal.ts

[Detailed contracts](api/schema-scene-radiance-temporal.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/scene-radiance-temporal.ts)

| Export | Kind |
| --- | --- |
| [`createSceneRadianceTemporalSamplingPlan`](api/schema-scene-radiance-temporal.md#createsceneradiancetemporalsamplingplan) | Runtime |
| [`CreateSceneRadianceTemporalSamplingPlanInput`](api/schema-scene-radiance-temporal.md#createsceneradiancetemporalsamplingplaninput) | Type |
| [`ReducedSceneRadianceTemporalExposure`](api/schema-scene-radiance-temporal.md#reducedsceneradiancetemporalexposure) | Type |
| [`reduceSceneRadianceTemporalSamples`](api/schema-scene-radiance-temporal.md#reducesceneradiancetemporalsamples) | Runtime |
| [`ReduceSceneRadianceTemporalSamplesInput`](api/schema-scene-radiance-temporal.md#reducesceneradiancetemporalsamplesinput) | Type |
| [`SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION`](api/schema-scene-radiance-temporal.md#scene_radiance_temporal_sampling_plan_version) | Runtime |
| [`SceneRadianceTemporalEvaluatedSample`](api/schema-scene-radiance-temporal.md#sceneradiancetemporalevaluatedsample) | Type |
| [`SceneRadianceTemporalQuery`](api/schema-scene-radiance-temporal.md#sceneradiancetemporalquery) | Type |
| [`SceneRadianceTemporalSamplingNode`](api/schema-scene-radiance-temporal.md#sceneradiancetemporalsamplingnode) | Type |
| [`SceneRadianceTemporalSamplingPlan`](api/schema-scene-radiance-temporal.md#sceneradiancetemporalsamplingplan) | Type |

## schema/scene-radiance.ts

[Detailed contracts](api/schema-scene-radiance.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/scene-radiance.ts)

| Export | Kind |
| --- | --- |
| [`assessSceneMaterialResponseFidelity`](api/schema-scene-radiance.md#assessscenematerialresponsefidelity) | Runtime |
| [`parseSceneMaterialResponseProfile`](api/schema-scene-radiance.md#parsescenematerialresponseprofile) | Runtime |
| [`parseSceneRadianceEvaluationRequest`](api/schema-scene-radiance.md#parsesceneradianceevaluationrequest) | Runtime |
| [`parseSceneRadianceEvaluationResult`](api/schema-scene-radiance.md#parsesceneradianceevaluationresult) | Runtime |
| [`parseSceneRadianceProviderProfile`](api/schema-scene-radiance.md#parsesceneradianceproviderprofile) | Runtime |
| [`SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION`](api/schema-scene-radiance.md#scene_material_response_profile_schema_version) | Runtime |
| [`SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION`](api/schema-scene-radiance.md#scene_radiance_evaluation_schema_version) | Runtime |
| [`SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION`](api/schema-scene-radiance.md#scene_radiance_provider_profile_schema_version) | Runtime |
| [`SceneMaterialResponseDefinition`](api/schema-scene-radiance.md#scenematerialresponsedefinition) | Type |
| [`SceneMaterialResponseFidelity`](api/schema-scene-radiance.md#scenematerialresponsefidelity) | Type |
| [`SceneMaterialResponseProfile`](api/schema-scene-radiance.md#scenematerialresponseprofile) | Type |
| [`SceneMaterialResponseRepresentation`](api/schema-scene-radiance.md#scenematerialresponserepresentation) | Type |
| [`SceneRadianceDataArtifactReference`](api/schema-scene-radiance.md#sceneradiancedataartifactreference) | Type |
| [`SceneRadianceEvaluationBindingAssessment`](api/schema-scene-radiance.md#sceneradianceevaluationbindingassessment) | Type |
| [`SceneRadianceEvaluationRequest`](api/schema-scene-radiance.md#sceneradianceevaluationrequest) | Type |
| [`SceneRadianceEvaluationResult`](api/schema-scene-radiance.md#sceneradianceevaluationresult) | Type |
| [`SceneRadianceEvaluationTarget`](api/schema-scene-radiance.md#sceneradianceevaluationtarget) | Type |
| [`SceneRadianceProviderProfile`](api/schema-scene-radiance.md#sceneradianceproviderprofile) | Type |
| [`SceneRadianceProviderSpectralFidelity`](api/schema-scene-radiance.md#sceneradianceproviderspectralfidelity) | Type |
| [`SceneRadianceProviderTransportFidelity`](api/schema-scene-radiance.md#sceneradianceprovidertransportfidelity) | Type |
| [`SceneRadianceProviderVisibilityFidelity`](api/schema-scene-radiance.md#sceneradianceprovidervisibilityfidelity) | Type |
| [`SceneRadianceScientificStatus`](api/schema-scene-radiance.md#sceneradiancescientificstatus) | Type |
| [`SceneRadianceUncertainty`](api/schema-scene-radiance.md#sceneradianceuncertainty) | Type |
| [`validateSceneRadianceEvaluationBindings`](api/schema-scene-radiance.md#validatesceneradianceevaluationbindings) | Runtime |
| [`ValidateSceneRadianceEvaluationBindingsInput`](api/schema-scene-radiance.md#validatesceneradianceevaluationbindingsinput) | Type |

## schema/scene.ts

[Detailed contracts](api/schema-scene.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/scene.ts)

| Export | Kind |
| --- | --- |
| [`SceneCapability`](api/schema-scene.md#scenecapability) | Type |
| [`SceneDefinition`](api/schema-scene.md#scenedefinition) | Type |
| [`SceneMotion`](api/schema-scene.md#scenemotion) | Type |
| [`SceneObject`](api/schema-scene.md#sceneobject) | Type |
| [`SceneRadiometry`](api/schema-scene.md#sceneradiometry) | Type |
| [`Vector3`](api/schema-scene.md#vector3) | Type |

## schema/validation.ts

[Detailed contracts](api/schema-validation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/schema/validation.ts)

| Export | Kind |
| --- | --- |
| [`parseCameraConfiguration`](api/schema-validation.md#parsecameraconfiguration) | Runtime |
| [`parseSceneDefinition`](api/schema-validation.md#parsescenedefinition) | Runtime |

## sensor/accumulated-charge.ts

[Detailed contracts](api/sensor-accumulated-charge.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/accumulated-charge.ts)

| Export | Kind |
| --- | --- |
| [`composeSensorAccumulatedCharge`](api/sensor-accumulated-charge.md#composesensoraccumulatedcharge) | Runtime |
| [`ComposeSensorAccumulatedChargeInput`](api/sensor-accumulated-charge.md#composesensoraccumulatedchargeinput) | Type |
| [`ComposeSensorPhotoAccumulatedChargeInput`](api/sensor-accumulated-charge.md#composesensorphotoaccumulatedchargeinput) | Type |
| [`parseSensorAccumulatedChargeCompletenessProfile`](api/sensor-accumulated-charge.md#parsesensoraccumulatedchargecompletenessprofile) | Runtime |
| [`parseSensorAdditionalStoredChargeComponent`](api/sensor-accumulated-charge.md#parsesensoradditionalstoredchargecomponent) | Runtime |
| [`SensorAccumulatedChargeCompletenessProfile`](api/sensor-accumulated-charge.md#sensoraccumulatedchargecompletenessprofile) | Type |
| [`SensorAccumulatedChargeComposition`](api/sensor-accumulated-charge.md#sensoraccumulatedchargecomposition) | Type |
| [`SensorAdditionalStoredChargeComponent`](api/sensor-accumulated-charge.md#sensoradditionalstoredchargecomponent) | Type |
| [`SensorAdditionalStoredChargeKind`](api/sensor-accumulated-charge.md#sensoradditionalstoredchargekind) | Type |
| [`SensorPhotoAccumulatedChargeComposition`](api/sensor-accumulated-charge.md#sensorphotoaccumulatedchargecomposition) | Type |

## sensor/architecture.ts

[Detailed contracts](api/sensor-architecture.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/architecture.ts)

| Export | Kind |
| --- | --- |
| [`parseSensorArchitectureProfile`](api/sensor-architecture.md#parsesensorarchitectureprofile) | Runtime |
| [`SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION`](api/sensor-architecture.md#sensor_architecture_profile_schema_version) | Runtime |
| [`SensorArchitectureFactProvenance`](api/sensor-architecture.md#sensorarchitecturefactprovenance) | Type |
| [`SensorArchitectureProfile`](api/sensor-architecture.md#sensorarchitectureprofile) | Type |
| [`SensorArchitectureProfileV0_2`](api/sensor-architecture.md#sensorarchitectureprofilev0_2) | Type |
| [`SensorArchitectureProfileV0_3`](api/sensor-architecture.md#sensorarchitectureprofilev0_3) | Type |
| [`SensorArchitectureReuseStatus`](api/sensor-architecture.md#sensorarchitecturereusestatus) | Type |
| [`SensorArchitectureSourceKind`](api/sensor-architecture.md#sensorarchitecturesourcekind) | Type |
| [`SensorColorSamplingFamily`](api/sensor-architecture.md#sensorcolorsamplingfamily) | Type |
| [`SensorIlluminationArchitecture`](api/sensor-architecture.md#sensorilluminationarchitecture) | Type |
| [`SensorIntegrationArchitecture`](api/sensor-architecture.md#sensorintegrationarchitecture) | Type |
| [`SensorReadoutArchitecture`](api/sensor-architecture.md#sensorreadoutarchitecture) | Type |
| [`SensorTechnologyFamily`](api/sensor-architecture.md#sensortechnologyfamily) | Type |
| [`SourcedSensorArchitectureFact`](api/sensor-architecture.md#sourcedsensorarchitecturefact) | Type |

## sensor/camera-saturation-capacity.ts

[Detailed contracts](api/sensor-camera-saturation-capacity.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/camera-saturation-capacity.ts)

| Export | Kind |
| --- | --- |
| [`assessSensorCameraSaturationCapacity`](api/sensor-camera-saturation-capacity.md#assesssensorcamerasaturationcapacity) | Runtime |
| [`AssessSensorCameraSaturationCapacityInput`](api/sensor-camera-saturation-capacity.md#assesssensorcamerasaturationcapacityinput) | Type |
| [`parseSensorCameraSaturationCapacityProfile`](api/sensor-camera-saturation-capacity.md#parsesensorcamerasaturationcapacityprofile) | Runtime |
| [`SensorCameraSaturationCapacityAssessment`](api/sensor-camera-saturation-capacity.md#sensorcamerasaturationcapacityassessment) | Type |
| [`SensorCameraSaturationCapacityProfile`](api/sensor-camera-saturation-capacity.md#sensorcamerasaturationcapacityprofile) | Type |
| [`SensorCameraSaturationSiteApplicability`](api/sensor-camera-saturation-capacity.md#sensorcamerasaturationsiteapplicability) | Type |
| [`SensorCameraSaturationTemperatureApplicability`](api/sensor-camera-saturation-capacity.md#sensorcamerasaturationtemperatureapplicability) | Type |

## sensor/capture-color-sampling-binding.ts

[Detailed contracts](api/sensor-capture-color-sampling-binding.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/capture-color-sampling-binding.ts)

| Export | Kind |
| --- | --- |
| [`CaptureModeFullFrameSampleIndex`](api/sensor-capture-color-sampling-binding.md#capturemodefullframesampleindex) | Type |
| [`ColorSamplingChannelComposition`](api/sensor-capture-color-sampling-binding.md#colorsamplingchannelcomposition) | Type |
| [`ColorSamplingChannelSiteCount`](api/sensor-capture-color-sampling-binding.md#colorsamplingchannelsitecount) | Type |
| [`ColorSamplingSiteGridDimensions`](api/sensor-capture-color-sampling-binding.md#colorsamplingsitegriddimensions) | Type |
| [`ColorSamplingSiteRect`](api/sensor-capture-color-sampling-binding.md#colorsamplingsiterect) | Type |
| [`GroupedCaptureModeSamplingAnchorDeclaration`](api/sensor-capture-color-sampling-binding.md#groupedcapturemodesamplinganchordeclaration) | Type |
| [`NativeEffectiveRasterColorSamplingBindingProfile`](api/sensor-capture-color-sampling-binding.md#nativeeffectiverastercolorsamplingbindingprofile) | Type |
| [`NativeEffectiveSampleRect`](api/sensor-capture-color-sampling-binding.md#nativeeffectivesamplerect) | Type |
| [`parseNativeEffectiveRasterColorSamplingBindingProfile`](api/sensor-capture-color-sampling-binding.md#parsenativeeffectiverastercolorsamplingbindingprofile) | Runtime |
| [`resolveCaptureModeColorSamplingContributors`](api/sensor-capture-color-sampling-binding.md#resolvecapturemodecolorsamplingcontributors) | Runtime |
| [`ResolveCaptureModeColorSamplingContributorsInput`](api/sensor-capture-color-sampling-binding.md#resolvecapturemodecolorsamplingcontributorsinput) | Type |
| [`ResolvedCaptureModeColorSamplingContributors`](api/sensor-capture-color-sampling-binding.md#resolvedcapturemodecolorsamplingcontributors) | Type |
| [`ResolvedNativeEffectiveRasterColorSamplingBinding`](api/sensor-capture-color-sampling-binding.md#resolvednativeeffectiverastercolorsamplingbinding) | Type |
| [`resolveNativeEffectiveRasterColorSamplingBinding`](api/sensor-capture-color-sampling-binding.md#resolvenativeeffectiverastercolorsamplingbinding) | Runtime |

## sensor/capture-mode-timing.ts

[Detailed contracts](api/sensor-capture-mode-timing.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/capture-mode-timing.ts)

| Export | Kind |
| --- | --- |
| [`CAPTURE_MODE_TIMING_PROFILE_SCHEMA_VERSION`](api/sensor-capture-mode-timing.md#capture_mode_timing_profile_schema_version) | Runtime |
| [`CaptureModeTimingProfile`](api/sensor-capture-mode-timing.md#capturemodetimingprofile) | Type |
| [`parseCaptureModeTimingProfile`](api/sensor-capture-mode-timing.md#parsecapturemodetimingprofile) | Runtime |
| [`resolveCaptureModeTiming`](api/sensor-capture-mode-timing.md#resolvecapturemodetiming) | Runtime |
| [`ResolveCaptureModeTimingInput`](api/sensor-capture-mode-timing.md#resolvecapturemodetiminginput) | Type |
| [`ResolvedCaptureModeTiming`](api/sensor-capture-mode-timing.md#resolvedcapturemodetiming) | Type |

## sensor/capture-mode.ts

[Detailed contracts](api/sensor-capture-mode.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/capture-mode.ts)

| Export | Kind |
| --- | --- |
| [`CaptureModeAcquisition`](api/sensor-capture-mode.md#capturemodeacquisition) | Type |
| [`CaptureModeDefinition`](api/sensor-capture-mode.md#capturemodedefinition) | Type |
| [`CaptureModeDependency`](api/sensor-capture-mode.md#capturemodedependency) | Type |
| [`CaptureModePerFrameSampling`](api/sensor-capture-mode.md#capturemodeperframesampling) | Type |
| [`CaptureModeProfile`](api/sensor-capture-mode.md#capturemodeprofile) | Type |
| [`CaptureModeReconstructionStage`](api/sensor-capture-mode.md#capturemodereconstructionstage) | Type |
| [`CaptureModeSampleCombinationDomain`](api/sensor-capture-mode.md#capturemodesamplecombinationdomain) | Type |
| [`CaptureModeSensorOffsetNativeSamples`](api/sensor-capture-mode.md#capturemodesensoroffsetnativesamples) | Type |
| [`DeclaredEffectiveCaptureSampling`](api/sensor-capture-mode.md#declaredeffectivecapturesampling) | Type |
| [`FixedMultiFrameCaptureAcquisition`](api/sensor-capture-mode.md#fixedmultiframecaptureacquisition) | Type |
| [`GroupedNativeCaptureSampling`](api/sensor-capture-mode.md#groupednativecapturesampling) | Type |
| [`NativeEffectiveCaptureSampling`](api/sensor-capture-mode.md#nativeeffectivecapturesampling) | Type |
| [`parseCaptureModeProfile`](api/sensor-capture-mode.md#parsecapturemodeprofile) | Runtime |
| [`resolveCaptureMode`](api/sensor-capture-mode.md#resolvecapturemode) | Runtime |
| [`ResolveCaptureModeInput`](api/sensor-capture-mode.md#resolvecapturemodeinput) | Type |
| [`ResolvedCaptureMode`](api/sensor-capture-mode.md#resolvedcapturemode) | Type |
| [`SingleFrameCaptureAcquisition`](api/sensor-capture-mode.md#singleframecaptureacquisition) | Type |
| [`SourcedCaptureModeFact`](api/sensor-capture-mode.md#sourcedcapturemodefact) | Type |
| [`VariableMultiFrameCaptureAcquisition`](api/sensor-capture-mode.md#variablemultiframecaptureacquisition) | Type |

## sensor/color-sampling.ts

[Detailed contracts](api/sensor-color-sampling.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/color-sampling.ts)

| Export | Kind |
| --- | --- |
| [`LayeredColorSamplingLayout`](api/sensor-color-sampling.md#layeredcolorsamplinglayout) | Type |
| [`MonochromeColorSamplingLayout`](api/sensor-color-sampling.md#monochromecolorsamplinglayout) | Type |
| [`NativeColorSamplingSiteCoordinateSystem`](api/sensor-color-sampling.md#nativecolorsamplingsitecoordinatesystem) | Type |
| [`NativeColorSamplingSiteIndex`](api/sensor-color-sampling.md#nativecolorsamplingsiteindex) | Type |
| [`parseSensorColorSamplingProfile`](api/sensor-color-sampling.md#parsesensorcolorsamplingprofile) | Runtime |
| [`PeriodicMosaicColorSamplingLayout`](api/sensor-color-sampling.md#periodicmosaiccolorsamplinglayout) | Type |
| [`resolveColorSamplingSite`](api/sensor-color-sampling.md#resolvecolorsamplingsite) | Runtime |
| [`ResolveColorSamplingSiteInput`](api/sensor-color-sampling.md#resolvecolorsamplingsiteinput) | Type |
| [`ResolvedColorSamplingSite`](api/sensor-color-sampling.md#resolvedcolorsamplingsite) | Type |
| [`SensorColorSamplingLayout`](api/sensor-color-sampling.md#sensorcolorsamplinglayout) | Type |
| [`SensorColorSamplingProfile`](api/sensor-color-sampling.md#sensorcolorsamplingprofile) | Type |
| [`SensorColorSamplingProfileCoordinateSystem`](api/sensor-color-sampling.md#sensorcolorsamplingprofilecoordinatesystem) | Type |

## sensor/constant-rate-temporal-integration.ts

[Detailed contracts](api/sensor-constant-rate-temporal-integration.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/constant-rate-temporal-integration.ts)

| Export | Kind |
| --- | --- |
| [`IntegrateStationarySensorRateInput`](api/sensor-constant-rate-temporal-integration.md#integratestationarysensorrateinput) | Type |
| [`integrateStationarySensorRateOverLocalExposure`](api/sensor-constant-rate-temporal-integration.md#integratestationarysensorrateoverlocalexposure) | Runtime |
| [`parseSensorRateTemporalStationarityProfile`](api/sensor-constant-rate-temporal-integration.md#parsesensorratetemporalstationarityprofile) | Runtime |
| [`SensorEqeExposureIntegration`](api/sensor-constant-rate-temporal-integration.md#sensoreqeexposureintegration) | Type |
| [`SensorRateStationarityStatus`](api/sensor-constant-rate-temporal-integration.md#sensorratestationaritystatus) | Type |
| [`SensorRateTemporalStationarityProfile`](api/sensor-constant-rate-temporal-integration.md#sensorratetemporalstationarityprofile) | Type |
| [`SensorResponsivityExposureIntegration`](api/sensor-constant-rate-temporal-integration.md#sensorresponsivityexposureintegration) | Type |
| [`SensorStationaryRateExposureIntegration`](api/sensor-constant-rate-temporal-integration.md#sensorstationaryrateexposureintegration) | Type |

## sensor/dark-current.ts

[Detailed contracts](api/sensor-dark-current.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/dark-current.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorDarkCurrentCharge`](api/sensor-dark-current.md#calculatesensordarkcurrentcharge) | Runtime |
| [`CalculateSensorDarkCurrentChargeInput`](api/sensor-dark-current.md#calculatesensordarkcurrentchargeinput) | Type |
| [`parseSensorDarkCurrentProfile`](api/sensor-dark-current.md#parsesensordarkcurrentprofile) | Runtime |
| [`SensorDarkCurrentCharge`](api/sensor-dark-current.md#sensordarkcurrentcharge) | Type |
| [`SensorDarkCurrentProfile`](api/sensor-dark-current.md#sensordarkcurrentprofile) | Type |
| [`SensorDarkCurrentSiteApplicability`](api/sensor-dark-current.md#sensordarkcurrentsiteapplicability) | Type |
| [`SensorDarkCurrentTemperatureModel`](api/sensor-dark-current.md#sensordarkcurrenttemperaturemodel) | Type |
| [`SensorPhotoDarkCurrentCharge`](api/sensor-dark-current.md#sensorphotodarkcurrentcharge) | Type |
| [`SensorTemporalDarkCurrentCharge`](api/sensor-dark-current.md#sensortemporaldarkcurrentcharge) | Type |

## sensor/environment-photo-signal.ts

[Detailed contracts](api/sensor-environment-photo-signal.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/environment-photo-signal.ts)

| Export | Kind |
| --- | --- |
| [`calculateEnvironmentSensorPhotoSignal`](api/sensor-environment-photo-signal.md#calculateenvironmentsensorphotosignal) | Runtime |
| [`CalculateEnvironmentSensorPhotoSignalInput`](api/sensor-environment-photo-signal.md#calculateenvironmentsensorphotosignalinput) | Type |
| [`EnvironmentApertureRadianceEvaluator`](api/sensor-environment-photo-signal.md#environmentapertureradianceevaluator) | Type |
| [`EnvironmentRadianceEvaluator`](api/sensor-environment-photo-signal.md#environmentradianceevaluator) | Type |
| [`EnvironmentSensorPhotoSignal`](api/sensor-environment-photo-signal.md#environmentsensorphotosignal) | Type |

## sensor/eqe-electron-rate.ts

[Detailed contracts](api/sensor-eqe-electron-rate.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/eqe-electron-rate.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorEqeElectronRate`](api/sensor-eqe-electron-rate.md#calculatesensoreqeelectronrate) | Runtime |
| [`CalculateSensorEqeElectronRateInput`](api/sensor-eqe-electron-rate.md#calculatesensoreqeelectronrateinput) | Type |
| [`SensorEqeAirPhotonEnergyContext`](api/sensor-eqe-electron-rate.md#sensoreqeairphotonenergycontext) | Type |
| [`SensorEqeAirRefractiveIndexSample`](api/sensor-eqe-electron-rate.md#sensoreqeairrefractiveindexsample) | Type |
| [`SensorEqeElectronRate`](api/sensor-eqe-electron-rate.md#sensoreqeelectronrate) | Type |
| [`SensorEqeWavelengthRateContribution`](api/sensor-eqe-electron-rate.md#sensoreqewavelengthratecontribution) | Type |

## sensor/eqe-local-exposure.ts

[Detailed contracts](api/sensor-eqe-local-exposure.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/eqe-local-exposure.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorEqeLocalExposure`](api/sensor-eqe-local-exposure.md#calculatesensoreqelocalexposure) | Runtime |
| [`CalculateSensorEqeLocalExposureInput`](api/sensor-eqe-local-exposure.md#calculatesensoreqelocalexposureinput) | Type |
| [`SensorEqeLocalExposure`](api/sensor-eqe-local-exposure.md#sensoreqelocalexposure) | Type |

## sensor/eqe-temporal-exposure.ts

[Detailed contracts](api/sensor-eqe-temporal-exposure.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/eqe-temporal-exposure.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorEqeTemporalExposure`](api/sensor-eqe-temporal-exposure.md#calculatesensoreqetemporalexposure) | Runtime |
| [`CalculateSensorEqeTemporalExposureInput`](api/sensor-eqe-temporal-exposure.md#calculatesensoreqetemporalexposureinput) | Type |
| [`SensorEqeTemporalExposure`](api/sensor-eqe-temporal-exposure.md#sensoreqetemporalexposure) | Type |

## sensor/exposure-window.ts

[Detailed contracts](api/sensor-exposure-window.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/exposure-window.ts)

| Export | Kind |
| --- | --- |
| [`calculateCaptureExposureWindows`](api/sensor-exposure-window.md#calculatecaptureexposurewindows) | Runtime |
| [`CalculateCaptureExposureWindowsInput`](api/sensor-exposure-window.md#calculatecaptureexposurewindowsinput) | Type |
| [`CaptureExposureBoundaryActuator`](api/sensor-exposure-window.md#captureexposureboundaryactuator) | Type |
| [`CaptureExposureWindows`](api/sensor-exposure-window.md#captureexposurewindows) | Type |
| [`CaptureExposureWindowSample`](api/sensor-exposure-window.md#captureexposurewindowsample) | Type |
| [`ExposureBoundarySchedule`](api/sensor-exposure-window.md#exposureboundaryschedule) | Type |
| [`ResolvedCaptureExposureBoundary`](api/sensor-exposure-window.md#resolvedcaptureexposureboundary) | Type |
| [`SimultaneousExposureBoundarySchedule`](api/sensor-exposure-window.md#simultaneousexposureboundaryschedule) | Type |
| [`SourcedCaptureBoundaryDirection`](api/sensor-exposure-window.md#sourcedcaptureboundarydirection) | Type |
| [`SourcedCaptureTimingSeconds`](api/sensor-exposure-window.md#sourcedcapturetimingseconds) | Type |
| [`UniformLinearExposureBoundarySchedule`](api/sensor-exposure-window.md#uniformlinearexposureboundaryschedule) | Type |

## sensor/fixed-pattern-noise.ts

[Detailed contracts](api/sensor-fixed-pattern-noise.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/fixed-pattern-noise.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorFixedPatternSite`](api/sensor-fixed-pattern-noise.md#calculatesensorfixedpatternsite) | Runtime |
| [`parseSensorFixedPatternNoiseProfile`](api/sensor-fixed-pattern-noise.md#parsesensorfixedpatternnoiseprofile) | Runtime |
| [`SENSOR_FIXED_PATTERN_NOISE_MODEL`](api/sensor-fixed-pattern-noise.md#sensor_fixed_pattern_noise_model) | Runtime |
| [`SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION`](api/sensor-fixed-pattern-noise.md#sensor_fixed_pattern_noise_profile_schema_version) | Runtime |
| [`SensorFixedPatternNoiseProfile`](api/sensor-fixed-pattern-noise.md#sensorfixedpatternnoiseprofile) | Type |
| [`SensorFixedPatternSiteValues`](api/sensor-fixed-pattern-noise.md#sensorfixedpatternsitevalues) | Type |

## sensor/iso-gain.ts

[Detailed contracts](api/sensor-iso-gain.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/iso-gain.ts)

| Export | Kind |
| --- | --- |
| [`createIsoGainReadoutRegimes`](api/sensor-iso-gain.md#createisogainreadoutregimes) | Runtime |
| [`CreateIsoGainReadoutRegimesInput`](api/sensor-iso-gain.md#createisogainreadoutregimesinput) | Type |
| [`IsoGainConversionGainMode`](api/sensor-iso-gain.md#isogainconversiongainmode) | Type |
| [`IsoGainReadoutRegimes`](api/sensor-iso-gain.md#isogainreadoutregimes) | Type |

## sensor/iso-signal-chain.ts

[Detailed contracts](api/sensor-iso-signal-chain.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/iso-signal-chain.ts)

| Export | Kind |
| --- | --- |
| [`GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION`](api/sensor-iso-signal-chain.md#generic_iso_signal_chain_preset_catalog_schema_version) | Runtime |
| [`GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION`](api/sensor-iso-signal-chain.md#generic_iso_signal_chain_profile_schema_version) | Runtime |
| [`GenericIsoCaptureModeSignalChainBinding`](api/sensor-iso-signal-chain.md#genericisocapturemodesignalchainbinding) | Type |
| [`GenericIsoExpandedRegimeBinding`](api/sensor-iso-signal-chain.md#genericisoexpandedregimebinding) | Type |
| [`GenericIsoSignalChainPreset`](api/sensor-iso-signal-chain.md#genericisosignalchainpreset) | Type |
| [`GenericIsoSignalChainPresetCatalog`](api/sensor-iso-signal-chain.md#genericisosignalchainpresetcatalog) | Type |
| [`GenericIsoSignalChainProfile`](api/sensor-iso-signal-chain.md#genericisosignalchainprofile) | Type |
| [`GenericIsoStandardRegimeBand`](api/sensor-iso-signal-chain.md#genericisostandardregimeband) | Type |
| [`parseGenericIsoSignalChainPresetCatalog`](api/sensor-iso-signal-chain.md#parsegenericisosignalchainpresetcatalog) | Runtime |
| [`parseGenericIsoSignalChainProfile`](api/sensor-iso-signal-chain.md#parsegenericisosignalchainprofile) | Runtime |
| [`ResolvedGenericIsoSignalChain`](api/sensor-iso-signal-chain.md#resolvedgenericisosignalchain) | Type |
| [`resolveGenericIsoSignalChain`](api/sensor-iso-signal-chain.md#resolvegenericisosignalchain) | Runtime |
| [`ResolveGenericIsoSignalChainInput`](api/sensor-iso-signal-chain.md#resolvegenericisosignalchaininput) | Type |
| [`resolveGenericIsoSignalChainPreset`](api/sensor-iso-signal-chain.md#resolvegenericisosignalchainpreset) | Runtime |

## sensor/local-exposure-binding.ts

[Detailed contracts](api/sensor-local-exposure-binding.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/local-exposure-binding.ts)

| Export | Kind |
| --- | --- |
| [`bindSensorRateToLocalExposure`](api/sensor-local-exposure-binding.md#bindsensorratetolocalexposure) | Runtime |
| [`BindSensorRateToLocalExposureInput`](api/sensor-local-exposure-binding.md#bindsensorratetolocalexposureinput) | Type |
| [`SensorInstantaneousRateResult`](api/sensor-local-exposure-binding.md#sensorinstantaneousrateresult) | Type |
| [`SensorRateLocalExposureBinding`](api/sensor-local-exposure-binding.md#sensorratelocalexposurebinding) | Type |

## sensor/optical-stack.ts

[Detailed contracts](api/sensor-optical-stack.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/optical-stack.ts)

| Export | Kind |
| --- | --- |
| [`AntiAliasingPointSplitComponent`](api/sensor-optical-stack.md#antialiasingpointsplitcomponent) | Type |
| [`parseSensorOpticalStackProfile`](api/sensor-optical-stack.md#parsesensoropticalstackprofile) | Runtime |
| [`resolveAntiAliasingSpatialKernel`](api/sensor-optical-stack.md#resolveantialiasingspatialkernel) | Runtime |
| [`ResolvedAntiAliasingSpatialKernel`](api/sensor-optical-stack.md#resolvedantialiasingspatialkernel) | Type |
| [`SensorEffectiveAntiAliasingSpatialResponse`](api/sensor-optical-stack.md#sensoreffectiveantialiasingspatialresponse) | Type |
| [`SensorMicrolensDeclaration`](api/sensor-optical-stack.md#sensormicrolensdeclaration) | Type |
| [`SensorOpticalStackComponent`](api/sensor-optical-stack.md#sensoropticalstackcomponent) | Type |
| [`SensorOpticalStackComponentRole`](api/sensor-optical-stack.md#sensoropticalstackcomponentrole) | Type |
| [`SensorOpticalStackProfile`](api/sensor-optical-stack.md#sensoropticalstackprofile) | Type |

## sensor/photon-energy.ts

[Detailed contracts](api/sensor-photon-energy.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/photon-energy.ts)

| Export | Kind |
| --- | --- |
| [`AirRefractiveIndexConditionPolicy`](api/sensor-photon-energy.md#airrefractiveindexconditionpolicy) | Type |
| [`AirRefractiveIndexReferenceConditions`](api/sensor-photon-energy.md#airrefractiveindexreferenceconditions) | Type |
| [`calculatePhotonEnergyFromWavelength`](api/sensor-photon-energy.md#calculatephotonenergyfromwavelength) | Runtime |
| [`CalculatePhotonEnergyFromWavelengthInput`](api/sensor-photon-energy.md#calculatephotonenergyfromwavelengthinput) | Type |
| [`parseSourcedAirPhaseRefractiveIndex`](api/sensor-photon-energy.md#parsesourcedairphaserefractiveindex) | Runtime |
| [`PhotonEnergyFromWavelength`](api/sensor-photon-energy.md#photonenergyfromwavelength) | Type |
| [`SourcedAirPhaseRefractiveIndex`](api/sensor-photon-energy.md#sourcedairphaserefractiveindex) | Type |

## sensor/physical-charge-capacity.ts

[Detailed contracts](api/sensor-physical-charge-capacity.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/physical-charge-capacity.ts)

| Export | Kind |
| --- | --- |
| [`assessSensorPhysicalChargeCapacity`](api/sensor-physical-charge-capacity.md#assesssensorphysicalchargecapacity) | Runtime |
| [`AssessSensorPhysicalChargeCapacityInput`](api/sensor-physical-charge-capacity.md#assesssensorphysicalchargecapacityinput) | Type |
| [`parseSensorPhysicalChargeCapacityProfile`](api/sensor-physical-charge-capacity.md#parsesensorphysicalchargecapacityprofile) | Runtime |
| [`SensorPhysicalChargeCapacityAssessment`](api/sensor-physical-charge-capacity.md#sensorphysicalchargecapacityassessment) | Type |
| [`SensorPhysicalChargeCapacityProfile`](api/sensor-physical-charge-capacity.md#sensorphysicalchargecapacityprofile) | Type |
| [`SensorPhysicalChargeCapacitySiteApplicability`](api/sensor-physical-charge-capacity.md#sensorphysicalchargecapacitysiteapplicability) | Type |
| [`SensorPhysicalChargeCapacityTemperatureApplicability`](api/sensor-physical-charge-capacity.md#sensorphysicalchargecapacitytemperatureapplicability) | Type |

## sensor/pixel-pitch.ts

[Detailed contracts](api/sensor-pixel-pitch.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/pixel-pitch.ts)

| Export | Kind |
| --- | --- |
| [`calculatePixelPitch`](api/sensor-pixel-pitch.md#calculatepixelpitch) | Runtime |
| [`CalculatePixelPitchInput`](api/sensor-pixel-pitch.md#calculatepixelpitchinput) | Type |
| [`PixelPitch`](api/sensor-pixel-pitch.md#pixelpitch) | Type |

## sensor/radiometry-readiness.ts

[Detailed contracts](api/sensor-radiometry-readiness.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/radiometry-readiness.ts)

| Export | Kind |
| --- | --- |
| [`assessRadiometryReadiness`](api/sensor-radiometry-readiness.md#assessradiometryreadiness) | Runtime |
| [`CalibrationArtifactReference`](api/sensor-radiometry-readiness.md#calibrationartifactreference) | Type |
| [`ExposureIntegrationRequirement`](api/sensor-radiometry-readiness.md#exposureintegrationrequirement) | Type |
| [`OpticalTransmissionRequirement`](api/sensor-radiometry-readiness.md#opticaltransmissionrequirement) | Type |
| [`parseRadiometryReadinessProfile`](api/sensor-radiometry-readiness.md#parseradiometryreadinessprofile) | Runtime |
| [`PhotositeCollectionAreaRequirement`](api/sensor-radiometry-readiness.md#photositecollectionarearequirement) | Type |
| [`PupilVignettingRequirement`](api/sensor-radiometry-readiness.md#pupilvignettingrequirement) | Type |
| [`RadiometryReadinessAssessment`](api/sensor-radiometry-readiness.md#radiometryreadinessassessment) | Type |
| [`RadiometryReadinessProfile`](api/sensor-radiometry-readiness.md#radiometryreadinessprofile) | Type |
| [`RadiometryRequirement`](api/sensor-radiometry-readiness.md#radiometryrequirement) | Type |
| [`RadiometryRequirementId`](api/sensor-radiometry-readiness.md#radiometryrequirementid) | Type |
| [`RadiometryScientificStatus`](api/sensor-radiometry-readiness.md#radiometryscientificstatus) | Type |
| [`RadiometryUncertaintyDeclaration`](api/sensor-radiometry-readiness.md#radiometryuncertaintydeclaration) | Type |
| [`SceneSpectralRadianceRequirement`](api/sensor-radiometry-readiness.md#scenespectralradiancerequirement) | Type |
| [`SensorResponseRequirement`](api/sensor-radiometry-readiness.md#sensorresponserequirement) | Type |

## sensor/raw-readout.ts

[Detailed contracts](api/sensor-raw-readout.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/raw-readout.ts)

| Export | Kind |
| --- | --- |
| [`calculateExpectedSensorReadout`](api/sensor-raw-readout.md#calculateexpectedsensorreadout) | Runtime |
| [`CalculateExpectedSensorReadoutInput`](api/sensor-raw-readout.md#calculateexpectedsensorreadoutinput) | Type |
| [`parseSensorChargeSamplingProfile`](api/sensor-raw-readout.md#parsesensorchargesamplingprofile) | Runtime |
| [`parseSensorReadoutConversionProfile`](api/sensor-raw-readout.md#parsesensorreadoutconversionprofile) | Runtime |
| [`ResolvedSensorReadoutRegime`](api/sensor-raw-readout.md#resolvedsensorreadoutregime) | Type |
| [`resolveSensorReadoutRegime`](api/sensor-raw-readout.md#resolvesensorreadoutregime) | Runtime |
| [`ResolveSensorReadoutRegimeInput`](api/sensor-raw-readout.md#resolvesensorreadoutregimeinput) | Type |
| [`SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION`](api/sensor-raw-readout.md#sensor_charge_sampling_profile_schema_version) | Runtime |
| [`SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION`](api/sensor-raw-readout.md#sensor_readout_conversion_profile_schema_version) | Runtime |
| [`SensorAdcIntegralNonLinearity`](api/sensor-raw-readout.md#sensoradcintegralnonlinearity) | Type |
| [`SensorAdditionalChargeSamplingModel`](api/sensor-raw-readout.md#sensoradditionalchargesamplingmodel) | Type |
| [`SensorAdditionalChargeSamplingPolicy`](api/sensor-raw-readout.md#sensoradditionalchargesamplingpolicy) | Type |
| [`SensorChargeRealization`](api/sensor-raw-readout.md#sensorchargerealization) | Type |
| [`SensorChargeSamplingProfile`](api/sensor-raw-readout.md#sensorchargesamplingprofile) | Type |
| [`SensorElectronicReadNoiseComponent`](api/sensor-raw-readout.md#sensorelectronicreadnoisecomponent) | Type |
| [`SensorExpectedReadoutSignal`](api/sensor-raw-readout.md#sensorexpectedreadoutsignal) | Type |
| [`SensorRawCodeSample`](api/sensor-raw-readout.md#sensorrawcodesample) | Type |
| [`SensorReadoutConversionProfile`](api/sensor-raw-readout.md#sensorreadoutconversionprofile) | Type |
| [`SensorReadoutConversionRegime`](api/sensor-raw-readout.md#sensorreadoutconversionregime) | Type |
| [`SensorReadoutExposureIndexGain`](api/sensor-raw-readout.md#sensorreadoutexposureindexgain) | Type |
| [`simulateSensorChargeRealization`](api/sensor-raw-readout.md#simulatesensorchargerealization) | Runtime |
| [`SimulateSensorChargeRealizationInput`](api/sensor-raw-readout.md#simulatesensorchargerealizationinput) | Type |
| [`simulateSensorRawCode`](api/sensor-raw-readout.md#simulatesensorrawcode) | Runtime |
| [`SimulateSensorRawCodeInput`](api/sensor-raw-readout.md#simulatesensorrawcodeinput) | Type |

## sensor/raw-reconstruction.ts

[Detailed contracts](api/sensor-raw-reconstruction.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/raw-reconstruction.ts)

| Export | Kind |
| --- | --- |
| [`BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION`](api/sensor-raw-reconstruction.md#built_in_bayer_demosaic_model_version) | Runtime |
| [`BuiltInBayerDemosaicKernel`](api/sensor-raw-reconstruction.md#builtinbayerdemosaickernel) | Type |
| [`BuiltInBayerDemosaicProfiles`](api/sensor-raw-reconstruction.md#builtinbayerdemosaicprofiles) | Type |
| [`createBuiltInBayerDemosaicProfiles`](api/sensor-raw-reconstruction.md#createbuiltinbayerdemosaicprofiles) | Runtime |
| [`CreateBuiltInBayerDemosaicProfilesInput`](api/sensor-raw-reconstruction.md#createbuiltinbayerdemosaicprofilesinput) | Type |
| [`createSensorRawCaptureSample`](api/sensor-raw-reconstruction.md#createsensorrawcapturesample) | Runtime |
| [`CreateSensorRawCaptureSampleInput`](api/sensor-raw-reconstruction.md#createsensorrawcapturesampleinput) | Type |
| [`parseSensorRawReconstructionProfile`](api/sensor-raw-reconstruction.md#parsesensorrawreconstructionprofile) | Runtime |
| [`RawReconstructionBorderHandling`](api/sensor-raw-reconstruction.md#rawreconstructionborderhandling) | Type |
| [`resolveSensorRawReconstruction`](api/sensor-raw-reconstruction.md#resolvesensorrawreconstruction) | Runtime |
| [`ResolveSensorRawReconstructionInput`](api/sensor-raw-reconstruction.md#resolvesensorrawreconstructioninput) | Type |
| [`SENSOR_RAW_CAPTURE_SAMPLE_VERSION`](api/sensor-raw-reconstruction.md#sensor_raw_capture_sample_version) | Runtime |
| [`SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION`](api/sensor-raw-reconstruction.md#sensor_raw_reconstruction_profile_schema_version) | Runtime |
| [`SensorRawCaptureSample`](api/sensor-raw-reconstruction.md#sensorrawcapturesample) | Type |
| [`SensorRawReconstructedPixel`](api/sensor-raw-reconstruction.md#sensorrawreconstructedpixel) | Type |
| [`SensorRawReconstructionChannelKernel`](api/sensor-raw-reconstruction.md#sensorrawreconstructionchannelkernel) | Type |
| [`SensorRawReconstructionKernelContribution`](api/sensor-raw-reconstruction.md#sensorrawreconstructionkernelcontribution) | Type |
| [`SensorRawReconstructionProfile`](api/sensor-raw-reconstruction.md#sensorrawreconstructionprofile) | Type |

## sensor/readout-exposure-linkage.ts

[Detailed contracts](api/sensor-readout-exposure-linkage.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/readout-exposure-linkage.ts)

| Export | Kind |
| --- | --- |
| [`assessReadoutExposureTimingLinkage`](api/sensor-readout-exposure-linkage.md#assessreadoutexposuretiminglinkage) | Runtime |
| [`AssessReadoutExposureTimingLinkageInput`](api/sensor-readout-exposure-linkage.md#assessreadoutexposuretiminglinkageinput) | Type |
| [`createRollingShutterCaptureExposureSchedule`](api/sensor-readout-exposure-linkage.md#createrollingshuttercaptureexposureschedule) | Runtime |
| [`ELECTRONIC_ROLLING_SHUTTER_MODEL`](api/sensor-readout-exposure-linkage.md#electronic_rolling_shutter_model) | Runtime |
| [`ElectronicRollingShutterExposureSchedule`](api/sensor-readout-exposure-linkage.md#electronicrollingshutterexposureschedule) | Type |
| [`ReadoutExposureBoundaryId`](api/sensor-readout-exposure-linkage.md#readoutexposureboundaryid) | Type |
| [`ReadoutExposureBoundarySpatialLink`](api/sensor-readout-exposure-linkage.md#readoutexposureboundaryspatiallink) | Type |
| [`ReadoutExposureBoundarySpatialLinkAssessment`](api/sensor-readout-exposure-linkage.md#readoutexposureboundaryspatiallinkassessment) | Type |
| [`ReadoutExposureSpatialPhaseOrientation`](api/sensor-readout-exposure-linkage.md#readoutexposurespatialphaseorientation) | Type |
| [`ReadoutExposureTimingLinkageAssessment`](api/sensor-readout-exposure-linkage.md#readoutexposuretiminglinkageassessment) | Type |
| [`ReadoutExposureTimingLinkageDeclaration`](api/sensor-readout-exposure-linkage.md#readoutexposuretiminglinkagedeclaration) | Type |
| [`resolveElectronicRollingShutterExposureSchedule`](api/sensor-readout-exposure-linkage.md#resolveelectronicrollingshutterexposureschedule) | Runtime |
| [`ResolveElectronicRollingShutterExposureScheduleInput`](api/sensor-readout-exposure-linkage.md#resolveelectronicrollingshutterexposurescheduleinput) | Type |

## sensor/readout-timing.ts

[Detailed contracts](api/sensor-readout-timing.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/readout-timing.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorReadoutTiming`](api/sensor-readout-timing.md#calculatesensorreadouttiming) | Runtime |
| [`CalculateSensorReadoutTimingInput`](api/sensor-readout-timing.md#calculatesensorreadouttiminginput) | Type |
| [`CaptureShutterMechanism`](api/sensor-readout-timing.md#captureshuttermechanism) | Type |
| [`GlobalSensorReadoutTimingDeclaration`](api/sensor-readout-timing.md#globalsensorreadouttimingdeclaration) | Type |
| [`NativeSensorReadoutScanDirection`](api/sensor-readout-timing.md#nativesensorreadoutscandirection) | Type |
| [`RollingSensorReadoutTimingDeclaration`](api/sensor-readout-timing.md#rollingsensorreadouttimingdeclaration) | Type |
| [`SensorReadoutMode`](api/sensor-readout-timing.md#sensorreadoutmode) | Type |
| [`SensorReadoutTiming`](api/sensor-readout-timing.md#sensorreadouttiming) | Type |
| [`SensorReadoutTimingDeclaration`](api/sensor-readout-timing.md#sensorreadouttimingdeclaration) | Type |
| [`SensorReadoutTimingSample`](api/sensor-readout-timing.md#sensorreadouttimingsample) | Type |
| [`SourcedSensorReadoutFact`](api/sensor-readout-timing.md#sourcedsensorreadoutfact) | Type |
| [`SourcedSensorTimingSeconds`](api/sensor-readout-timing.md#sourcedsensortimingseconds) | Type |

## sensor/response-application-compatibility.ts

[Detailed contracts](api/sensor-response-application-compatibility.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/response-application-compatibility.ts)

| Export | Kind |
| --- | --- |
| [`assessSensorResponseApplicationCompatibility`](api/sensor-response-application-compatibility.md#assesssensorresponseapplicationcompatibility) | Runtime |
| [`AssessSensorResponseApplicationCompatibilityInput`](api/sensor-response-application-compatibility.md#assesssensorresponseapplicationcompatibilityinput) | Type |
| [`parseSensorResponseApplicationProfile`](api/sensor-response-application-compatibility.md#parsesensorresponseapplicationprofile) | Runtime |
| [`SensorResponseApplicationCompatibilityAssessment`](api/sensor-response-application-compatibility.md#sensorresponseapplicationcompatibilityassessment) | Type |
| [`SensorResponseApplicationCompatibilityBlocker`](api/sensor-response-application-compatibility.md#sensorresponseapplicationcompatibilityblocker) | Type |
| [`SensorResponseApplicationProfile`](api/sensor-response-application-compatibility.md#sensorresponseapplicationprofile) | Type |
| [`SensorResponseIncidentAreaBasis`](api/sensor-response-application-compatibility.md#sensorresponseincidentareabasis) | Type |
| [`SensorResponseReferenceConditionPolicy`](api/sensor-response-application-compatibility.md#sensorresponsereferenceconditionpolicy) | Type |
| [`SensorResponseSignalPath`](api/sensor-response-application-compatibility.md#sensorresponsesignalpath) | Type |
| [`SensorResponseSourcePlane`](api/sensor-response-application-compatibility.md#sensorresponsesourceplane) | Type |
| [`SensorResponseSpatialModel`](api/sensor-response-application-compatibility.md#sensorresponsespatialmodel) | Type |
| [`SourcedSensorResponseSourcePlane`](api/sensor-response-application-compatibility.md#sourcedsensorresponsesourceplane) | Type |

## sensor/response-operating-range.ts

[Detailed contracts](api/sensor-response-operating-range.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/response-operating-range.ts)

| Export | Kind |
| --- | --- |
| [`assessSensorResponseOperatingRange`](api/sensor-response-operating-range.md#assesssensorresponseoperatingrange) | Runtime |
| [`AssessSensorResponseOperatingRangeInput`](api/sensor-response-operating-range.md#assesssensorresponseoperatingrangeinput) | Type |
| [`parseSensorResponseOperatingRangeProfile`](api/sensor-response-operating-range.md#parsesensorresponseoperatingrangeprofile) | Runtime |
| [`SensorResponseLinearityCriterion`](api/sensor-response-operating-range.md#sensorresponselinearitycriterion) | Type |
| [`SensorResponseOperatingInputRange`](api/sensor-response-operating-range.md#sensorresponseoperatinginputrange) | Type |
| [`SensorResponseOperatingRangeAssessment`](api/sensor-response-operating-range.md#sensorresponseoperatingrangeassessment) | Type |
| [`SensorResponseOperatingRangeBlocker`](api/sensor-response-operating-range.md#sensorresponseoperatingrangeblocker) | Type |
| [`SensorResponseOperatingRangeProfile`](api/sensor-response-operating-range.md#sensorresponseoperatingrangeprofile) | Type |
| [`SensorResponseOperatingSpatialLinearityModel`](api/sensor-response-operating-range.md#sensorresponseoperatingspatiallinearitymodel) | Type |
| [`SensorResponseOperatingSpectralInputModel`](api/sensor-response-operating-range.md#sensorresponseoperatingspectralinputmodel) | Type |
| [`SensorResponseOperatingWavelengthApplicability`](api/sensor-response-operating-range.md#sensorresponseoperatingwavelengthapplicability) | Type |

## sensor/responsivity-photocurrent.ts

[Detailed contracts](api/sensor-responsivity-photocurrent.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/responsivity-photocurrent.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorResponsivityPhotocurrent`](api/sensor-responsivity-photocurrent.md#calculatesensorresponsivityphotocurrent) | Runtime |
| [`CalculateSensorResponsivityPhotocurrentInput`](api/sensor-responsivity-photocurrent.md#calculatesensorresponsivityphotocurrentinput) | Type |
| [`parseSensorResponsivityElectricalApplicabilityProfile`](api/sensor-responsivity-photocurrent.md#parsesensorresponsivityelectricalapplicabilityprofile) | Runtime |
| [`SensorResponsivityBiasCondition`](api/sensor-responsivity-photocurrent.md#sensorresponsivitybiascondition) | Type |
| [`SensorResponsivityElectricalApplicabilityProfile`](api/sensor-responsivity-photocurrent.md#sensorresponsivityelectricalapplicabilityprofile) | Type |
| [`SensorResponsivityElectricalConditionPolicy`](api/sensor-responsivity-photocurrent.md#sensorresponsivityelectricalconditionpolicy) | Type |
| [`SensorResponsivityElectricalConditions`](api/sensor-responsivity-photocurrent.md#sensorresponsivityelectricalconditions) | Type |
| [`SensorResponsivityPhotocurrent`](api/sensor-responsivity-photocurrent.md#sensorresponsivityphotocurrent) | Type |
| [`SensorResponsivityReadoutLoadCondition`](api/sensor-responsivity-photocurrent.md#sensorresponsivityreadoutloadcondition) | Type |
| [`SensorResponsivityWavelengthCurrentContribution`](api/sensor-responsivity-photocurrent.md#sensorresponsivitywavelengthcurrentcontribution) | Type |

## sensor/sampling-aperture.ts

[Detailed contracts](api/sensor-sampling-aperture.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/sampling-aperture.ts)

| Export | Kind |
| --- | --- |
| [`NativeSensorPhysicalBoundsMm`](api/sensor-sampling-aperture.md#nativesensorphysicalboundsmm) | Type |
| [`NativeSensorPhysicalPointMm`](api/sensor-sampling-aperture.md#nativesensorphysicalpointmm) | Type |
| [`parseSensorSamplingApertureProfile`](api/sensor-sampling-aperture.md#parsesensorsamplingapertureprofile) | Runtime |
| [`ResolvedSensorSamplingAperture`](api/sensor-sampling-aperture.md#resolvedsensorsamplingaperture) | Type |
| [`resolveSensorSamplingAperture`](api/sensor-sampling-aperture.md#resolvesensorsamplingaperture) | Runtime |
| [`ResolveSensorSamplingApertureInput`](api/sensor-sampling-aperture.md#resolvesensorsamplingapertureinput) | Type |
| [`SensorGeometricSensitiveAperture`](api/sensor-sampling-aperture.md#sensorgeometricsensitiveaperture) | Type |
| [`SensorSamplingApertureProfile`](api/sensor-sampling-aperture.md#sensorsamplingapertureprofile) | Type |
| [`SensorSiteCenterLatticeRegistration`](api/sensor-sampling-aperture.md#sensorsitecenterlatticeregistration) | Type |

## sensor/scene-eqe-temporal-exposure.ts

[Detailed contracts](api/sensor-scene-eqe-temporal-exposure.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/scene-eqe-temporal-exposure.ts)

| Export | Kind |
| --- | --- |
| [`calculateSceneSensorEqeTemporalExposure`](api/sensor-scene-eqe-temporal-exposure.md#calculatescenesensoreqetemporalexposure) | Runtime |
| [`CalculateSceneSensorEqeTemporalExposureInput`](api/sensor-scene-eqe-temporal-exposure.md#calculatescenesensoreqetemporalexposureinput) | Type |
| [`SceneSensorEqeTemporalExposure`](api/sensor-scene-eqe-temporal-exposure.md#scenesensoreqetemporalexposure) | Type |

## sensor/sensor-characteristics.ts

[Detailed contracts](api/sensor-sensor-characteristics.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/sensor-characteristics.ts)

| Export | Kind |
| --- | --- |
| [`SimulateCaptureNoiseComponents`](api/sensor-sensor-characteristics.md#simulatecapturenoisecomponents) | Type |
| [`SimulateCaptureSensorCharacteristics`](api/sensor-sensor-characteristics.md#simulatecapturesensorcharacteristics) | Type |
| [`SimulateCaptureSensorReport`](api/sensor-sensor-characteristics.md#simulatecapturesensorreport) | Type |

## sensor/sensor-geometry.ts

[Detailed contracts](api/sensor-sensor-geometry.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/sensor-geometry.ts)

| Export | Kind |
| --- | --- |
| [`calculateImagingAreaMetrics`](api/sensor-sensor-geometry.md#calculateimagingareametrics) | Runtime |
| [`calculateSensorGeometryMetrics`](api/sensor-sensor-geometry.md#calculatesensorgeometrymetrics) | Runtime |
| [`CalculateSensorGeometryMetricsInput`](api/sensor-sensor-geometry.md#calculatesensorgeometrymetricsinput) | Type |
| [`ImagingAreaMetrics`](api/sensor-sensor-geometry.md#imagingareametrics) | Type |
| [`NativeImageRaster`](api/sensor-sensor-geometry.md#nativeimageraster) | Type |
| [`RasterDimensions`](api/sensor-sensor-geometry.md#rasterdimensions) | Type |
| [`SensorGeometryMetrics`](api/sensor-sensor-geometry.md#sensorgeometrymetrics) | Type |
| [`SensorImagingArea`](api/sensor-sensor-geometry.md#sensorimagingarea) | Type |

## sensor/signal-noise.ts

[Detailed contracts](api/sensor-signal-noise.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/signal-noise.ts)

| Export | Kind |
| --- | --- |
| [`calculatePhotoelectrons`](api/sensor-signal-noise.md#calculatephotoelectrons) | Runtime |
| [`CalculatePhotoelectronsInput`](api/sensor-signal-noise.md#calculatephotoelectronsinput) | Type |
| [`calculateSignalToNoise`](api/sensor-signal-noise.md#calculatesignaltonoise) | Runtime |
| [`CalculateSignalToNoiseInput`](api/sensor-signal-noise.md#calculatesignaltonoiseinput) | Type |
| [`SignalToNoise`](api/sensor-signal-noise.md#signaltonoise) | Type |

## sensor/spatial-sample-reduction.ts

[Detailed contracts](api/sensor-spatial-sample-reduction.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/spatial-sample-reduction.ts)

| Export | Kind |
| --- | --- |
| [`reduceSensorSpatialSamplingQuadrature`](api/sensor-spatial-sample-reduction.md#reducesensorspatialsamplingquadrature) | Runtime |
| [`ReduceSensorSpatialSamplingQuadratureInput`](api/sensor-spatial-sample-reduction.md#reducesensorspatialsamplingquadratureinput) | Type |
| [`SensorSpatialQuadratureNodeIdentity`](api/sensor-spatial-sample-reduction.md#sensorspatialquadraturenodeidentity) | Type |
| [`SensorSpatialQuadratureNodeValue`](api/sensor-spatial-sample-reduction.md#sensorspatialquadraturenodevalue) | Type |
| [`SensorSpatialSampleReduction`](api/sensor-spatial-sample-reduction.md#sensorspatialsamplereduction) | Type |
| [`SensorSpatialSampleReductionValue`](api/sensor-spatial-sample-reduction.md#sensorspatialsamplereductionvalue) | Type |
| [`SensorSpatialSampleValueDomain`](api/sensor-spatial-sample-reduction.md#sensorspatialsamplevaluedomain) | Type |

## sensor/spatial-sampling-quadrature.ts

[Detailed contracts](api/sensor-spatial-sampling-quadrature.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/spatial-sampling-quadrature.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorSpatialSamplingQuadrature`](api/sensor-spatial-sampling-quadrature.md#calculatesensorspatialsamplingquadrature) | Runtime |
| [`CalculateSensorSpatialSamplingQuadratureInput`](api/sensor-spatial-sampling-quadrature.md#calculatesensorspatialsamplingquadratureinput) | Type |
| [`SensorSpatialSamplingQuadrature`](api/sensor-spatial-sampling-quadrature.md#sensorspatialsamplingquadrature) | Type |
| [`SensorSpatialSamplingQuadratureNode`](api/sensor-spatial-sampling-quadrature.md#sensorspatialsamplingquadraturenode) | Type |

## sensor/spatio-spectral-reduction.ts

[Detailed contracts](api/sensor-spatio-spectral-reduction.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/spatio-spectral-reduction.ts)

| Export | Kind |
| --- | --- |
| [`reduceSensorSpatioSpectralIrradiance`](api/sensor-spatio-spectral-reduction.md#reducesensorspatiospectralirradiance) | Runtime |
| [`ReduceSensorSpatioSpectralIrradianceInput`](api/sensor-spatio-spectral-reduction.md#reducesensorspatiospectralirradianceinput) | Type |
| [`SensorSpatioSpectralIrradianceReduction`](api/sensor-spatio-spectral-reduction.md#sensorspatiospectralirradiancereduction) | Type |
| [`SensorSpatioSpectralIrradianceSample`](api/sensor-spatio-spectral-reduction.md#sensorspatiospectralirradiancesample) | Type |
| [`SensorSpatioSpectralNodeIdentity`](api/sensor-spatio-spectral-reduction.md#sensorspatiospectralnodeidentity) | Type |
| [`SensorSpatioSpectralWavelengthReduction`](api/sensor-spatio-spectral-reduction.md#sensorspatiospectralwavelengthreduction) | Type |

## sensor/spectral-coverage.ts

[Detailed contracts](api/sensor-spectral-coverage.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/spectral-coverage.ts)

| Export | Kind |
| --- | --- |
| [`createSensorSpectralCoverageParticipant`](api/sensor-spectral-coverage.md#createsensorspectralcoverageparticipant) | Runtime |
| [`CreateSensorSpectralCoverageParticipantInput`](api/sensor-spectral-coverage.md#createsensorspectralcoverageparticipantinput) | Type |

## sensor/spectral-quadrature.ts

[Detailed contracts](api/sensor-spectral-quadrature.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/spectral-quadrature.ts)

| Export | Kind |
| --- | --- |
| [`calculateSensorSpectralQuadrature`](api/sensor-spectral-quadrature.md#calculatesensorspectralquadrature) | Runtime |
| [`CalculateSensorSpectralQuadratureInput`](api/sensor-spectral-quadrature.md#calculatesensorspectralquadratureinput) | Type |
| [`SensorSpectralQuadrature`](api/sensor-spectral-quadrature.md#sensorspectralquadrature) | Type |
| [`SensorSpectralQuadratureNode`](api/sensor-spectral-quadrature.md#sensorspectralquadraturenode) | Type |
| [`SensorSpectralWavelengthRangeNanometers`](api/sensor-spectral-quadrature.md#sensorspectralwavelengthrangenanometers) | Type |

## sensor/spectral-response.ts

[Detailed contracts](api/sensor-spectral-response.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/spectral-response.ts)

| Export | Kind |
| --- | --- |
| [`EffectiveSensorResponseScope`](api/sensor-spectral-response.md#effectivesensorresponsescope) | Type |
| [`parseSensorSpectralResponseProfile`](api/sensor-spectral-response.md#parsesensorspectralresponseprofile) | Runtime |
| [`ResolvedSensorSpectralResponse`](api/sensor-spectral-response.md#resolvedsensorspectralresponse) | Type |
| [`ResolvedSensorSpectralResponseValue`](api/sensor-spectral-response.md#resolvedsensorspectralresponsevalue) | Type |
| [`resolveSensorSpectralResponseAtWavelength`](api/sensor-spectral-response.md#resolvesensorspectralresponseatwavelength) | Runtime |
| [`ResolveSensorSpectralResponseAtWavelengthInput`](api/sensor-spectral-response.md#resolvesensorspectralresponseatwavelengthinput) | Type |
| [`SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT`](api/sensor-spectral-response.md#sensor_spectral_response_channel_binding_format) | Runtime |
| [`SensorSpectralChannelResponse`](api/sensor-spectral-response.md#sensorspectralchannelresponse) | Type |
| [`SensorSpectralReferenceConditions`](api/sensor-spectral-response.md#sensorspectralreferenceconditions) | Type |
| [`SensorSpectralResponseChannelBinding`](api/sensor-spectral-response.md#sensorspectralresponsechannelbinding) | Type |
| [`SensorSpectralResponseProfile`](api/sensor-spectral-response.md#sensorspectralresponseprofile) | Type |
| [`SensorSpectralResponseScientificStatus`](api/sensor-spectral-response.md#sensorspectralresponsescientificstatus) | Type |
| [`SensorSpectralResponseUncertainty`](api/sensor-spectral-response.md#sensorspectralresponseuncertainty) | Type |
| [`SpectralFractionCurve`](api/sensor-spectral-response.md#spectralfractioncurve) | Type |
| [`SpectralFractionSample`](api/sensor-spectral-response.md#spectralfractionsample) | Type |
| [`SpectralResponsivityCurve`](api/sensor-spectral-response.md#spectralresponsivitycurve) | Type |
| [`SpectralResponsivitySample`](api/sensor-spectral-response.md#spectralresponsivitysample) | Type |

## sensor/temporal-photo-signal.ts

[Detailed contracts](api/sensor-temporal-photo-signal.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/sensor/temporal-photo-signal.ts)

| Export | Kind |
| --- | --- |
| [`createSensorEqeTemporalPhotoSignal`](api/sensor-temporal-photo-signal.md#createsensoreqetemporalphotosignal) | Runtime |
| [`parseSensorEqeTemporalPhotoSignal`](api/sensor-temporal-photo-signal.md#parsesensoreqetemporalphotosignal) | Runtime |
| [`SensorEqePhotoExposure`](api/sensor-temporal-photo-signal.md#sensoreqephotoexposure) | Type |
| [`SensorEqeTemporalPhotoSignal`](api/sensor-temporal-photo-signal.md#sensoreqetemporalphotosignal) | Type |

## simulation/poc-simulation.ts

[Detailed contracts](api/simulation-poc-simulation.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/simulation/poc-simulation.ts)

| Export | Kind |
| --- | --- |
| [`POC_SIMULATION_API_VERSION`](api/simulation-poc-simulation.md#poc_simulation_api_version) | Runtime |
| [`PocSimulationRequest`](api/simulation-poc-simulation.md#pocsimulationrequest) | Type |
| [`PocSimulationResponse`](api/simulation-poc-simulation.md#pocsimulationresponse) | Type |
| [`simulatePocCamera`](api/simulation-poc-simulation.md#simulatepoccamera) | Runtime |

## stabilization/camera-shake.ts

[Detailed contracts](api/stabilization-camera-shake.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/stabilization/camera-shake.ts)

| Export | Kind |
| --- | --- |
| [`CameraShakeBlurSample`](api/stabilization-camera-shake.md#camerashakeblursample) | Type |
| [`CameraShakeEstimate`](api/stabilization-camera-shake.md#camerashakeestimate) | Type |
| [`estimateCameraShakeBlur`](api/stabilization-camera-shake.md#estimatecamerashakeblur) | Runtime |
| [`EstimateCameraShakeBlurInput`](api/stabilization-camera-shake.md#estimatecamerashakeblurinput) | Type |

## stabilization/system.ts

[Detailed contracts](api/stabilization-system.md) · [Source](https://github.com/Photivra/photivra/blob/main/src/stabilization/system.ts)

| Export | Kind |
| --- | --- |
| [`calculateStabilizedCaptureTemporalSamples`](api/stabilization-system.md#calculatestabilizedcapturetemporalsamples) | Runtime |
| [`CalculateStabilizedCaptureTemporalSamplesInput`](api/stabilization-system.md#calculatestabilizedcapturetemporalsamplesinput) | Type |
| [`calculateStabilizedRotationTrajectory`](api/stabilization-system.md#calculatestabilizedrotationtrajectory) | Runtime |
| [`CalculateStabilizedRotationTrajectoryInput`](api/stabilization-system.md#calculatestabilizedrotationtrajectoryinput) | Type |
| [`parseStabilizationDisturbanceTrajectory`](api/stabilization-system.md#parsestabilizationdisturbancetrajectory) | Runtime |
| [`parseStabilizationSystemProfile`](api/stabilization-system.md#parsestabilizationsystemprofile) | Runtime |
| [`PhysicalStabilizationArchitecture`](api/stabilization-system.md#physicalstabilizationarchitecture) | Type |
| [`STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION`](api/stabilization-system.md#stabilization_disturbance_trajectory_version) | Runtime |
| [`STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION`](api/stabilization-system.md#stabilization_system_profile_schema_version) | Runtime |
| [`StabilizationAngularStateRad`](api/stabilization-system.md#stabilizationangularstaterad) | Type |
| [`StabilizationAxisResolution`](api/stabilization-system.md#stabilizationaxisresolution) | Type |
| [`StabilizationAxisResponseProfile`](api/stabilization-system.md#stabilizationaxisresponseprofile) | Type |
| [`StabilizationCaptureKind`](api/stabilization-system.md#stabilizationcapturekind) | Type |
| [`StabilizationCoordinatedAllocation`](api/stabilization-system.md#stabilizationcoordinatedallocation) | Type |
| [`StabilizationDisturbanceSample`](api/stabilization-system.md#stabilizationdisturbancesample) | Type |
| [`StabilizationDisturbanceTrajectory`](api/stabilization-system.md#stabilizationdisturbancetrajectory) | Type |
| [`StabilizationPanningPolicy`](api/stabilization-system.md#stabilizationpanningpolicy) | Type |
| [`StabilizationRotationAxis`](api/stabilization-system.md#stabilizationrotationaxis) | Type |
| [`StabilizationSystemProfile`](api/stabilization-system.md#stabilizationsystemprofile) | Type |
| [`StabilizedCaptureTemporalNode`](api/stabilization-system.md#stabilizedcapturetemporalnode) | Type |
| [`StabilizedCaptureTemporalPoint`](api/stabilization-system.md#stabilizedcapturetemporalpoint) | Type |
| [`StabilizedCaptureTemporalSamples`](api/stabilization-system.md#stabilizedcapturetemporalsamples) | Type |
| [`StabilizedRotationSample`](api/stabilization-system.md#stabilizedrotationsample) | Type |
| [`StabilizedRotationTrajectory`](api/stabilization-system.md#stabilizedrotationtrajectory) | Type |
