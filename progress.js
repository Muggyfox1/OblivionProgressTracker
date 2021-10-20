"use strict"
//functions that save and load user progess.

var savedata;
var settings;
const version = 6;

function saveCookie(name,value){
	//save for 10 years
	var expiry = new Date()
	expiry.setDate(expiry.getDate()+365*10);
	document.cookie = name+"="+JSON.stringify(value)+"; expires="+expiry.toUTCString()+"; SameSite = Lax";

}

function loadCookie(name){
	try{
		let thisCookie = document.cookie
		.split('; ')
		.find(row => row.startsWith(name+"="));
		let splitIndex = thisCookie.indexOf("=");
		let cookieValue = thisCookie.substring(splitIndex+1);
		return JSON.parse(cookieValue);
	}
	catch{
		return null;
	}
}

//compress save data object for more efficient stringification
//savedata is in the format where IDs are an associative array of boolean values. 
//change this to linear array of int values so its smaller.
function compressSaveData(saveDataObject){
	var compressed = {};
	compressed.version = saveDataObject.version;
	for(const propname in saveDataObject){
		const matchingClass = classes.find(x=>x.name == propname);
		if(matchingClass != null && matchingClass.standard) {
			//for "standard" classes, we do a more efficient compression
			compressed[propname] = [];
			const elements = saveDataObject[propname];
			for(const elementPropName in elements){
				compressed[propname][parseInt(elementPropName)] = elements[elementPropName] == 1 ?1:0;
			}
		}
		else{
			//otherwise, we just leave it be.
			compressed[propname] = savedata[propname];
		}
	}
	return compressed;
}

function decompressSaveData(compressedSaveData){
	//expand cookie data back to nice, usable form.
	var decompressedSaveData = {};
	for(const propname in compressedSaveData){
		const matchingClass = classes.find(x=>x.name == propname);
		if(matchingClass != null && matchingClass.standard) {
			decompressedSaveData[propname] = {};
			let elements = compressedSaveData[propname];
			for(let i = 0; i < elements.length; i++){
				if(elements[i] != null){
					decompressedSaveData[propname][i] = (elements[i] == 1);
				}
			}
		}
		else{
			decompressedSaveData[propname] = compressedSaveData[propname];
		}
	}
	return decompressedSaveData;
}

function saveProgressToCookie(){
	saveCookie("progress",compressSaveData(savedata));
}

/**
 * Load progress and settings.
 */
function loadProgressFromCookie(){
	settings = loadCookie("settings");
	if(settings == null){
		settings = {};
	}
	
	var compressed = loadCookie("progress");
	
	if(compressed){
		savedata = decompressSaveData(compressed);
		if(savedata.version != version){
			alert("Save data is out of date. Percentages may be wrong.")
		}
		document.dispatchEvent(new Event("progressLoad"));
		return true;
	}
	else{
		return false;
	}
}

//helper function for resetProgress
function resetProgressForTree(classname, jsonNode){
	runOnTree(jsonNode,(e=>{
		if(e.type == "number"){
			savedata[classname][e.id] = 0;
		}
		else{
			savedata[classname][e.id] = false;
		}}),0,(e=>e.id != null));
}

//generate a new, clean savedata object, and saves it to cookie.
function resetProgress(shouldConfirm=false){
	var execute = true;
	if(shouldConfirm){
		execute = confirm("press OK to reset data");
	}
	if(execute){
		savedata = new Object();
		savedata.version = version;
		
		for(const klass of classes){
			if(klass.shouldSave){
				savedata[klass.name] = {};
				resetProgressForTree(klass.name, jsondata[klass.name]);
			}
		}
	}
	saveProgressToCookie();
	document.dispatchEvent(new Event("progressLoad"));
}

//Topbar percentage update and helper functions
function updateTopbarPercent(){
	//we could probably cache the hives that aren't modified
	var percentCompleteSoFar = 0.0;
	for(const klass of progressClasses) {
		const hive = jsondata[klass.name];
		if(hive?.version >= 2){
			percentCompleteSoFar += runOnTree(hive, node=>getSubtotalCompletion(node,klass.name), 0, node=>node.weight != null);
		}
		else{
			let classtotal = 0;
			let classchecked = 0;
			for (const id in savedata[klass.name]){
				if(savedata[klass.name][id] == true){
					classchecked += 1;
				}
				classtotal +=1;
			}
			
			//update overview and totals
			percentCompleteSoFar += (classchecked/classtotal) * (klass.weight);
		}
	}
	
	//we can turn percentCompleteSoFar into an actual percent here, instead of dividing by total in each segment, since
	// (a / total + b/total + c/total + ...) == (a+b+c+..)/total
	percentCompleteSoFar = percentCompleteSoFar / totalweight;
	
	//round progress to 2 decimal places
	var progress = Math.round((percentCompleteSoFar * 100)*100)/100;
	document.querySelectorAll('[id=totalProgressPercent]').forEach(element => {
		element.innerHTML = progress.toString();
		if(element.parentElement.className == "topbarSection"){
			element.parentElement.style = `background: linear-gradient(to right, green ${progress.toString()}%, red ${progress.toString()}%);`;
		}
	});
	saveProgressToCookie();
}

function getSubtotalCompletion(subtotalJsonNode,classname){
	const weight = subtotalJsonNode.weight;
	const [items,total] = sumCompletionItems(subtotalJsonNode,classname);
	
	//try to find subtotals
	//this may fail if we have multiple score nodes from different hives wiht the same name.
	const overviewId = "overview_"+subtotalJsonNode.name.replaceAll(" ","_").toLowerCase();
	const maybeItem = document.getElementById(overviewId);
	if(maybeItem){
		//add this to correct subtotal slot
		maybeItem.innerText = items.toString() + "/" + total.toString();
	}
	
	// and finally, return weighted progress for total progress.
	return (items/total)*weight;
}

function sumCompletionItems(jsonNode,classname){
	if(jsonNode.id != null){
		return sumCompletionSingleCell(jsonNode,classname);
	}
	else{
		var completed = 0;
		var total = 0;
		for(const element of jsonNode.elements){
			let innerResult = sumCompletionItems(element,classname);
			completed += innerResult[0];
			total += innerResult[1];
		}
		return [completed,total];
	}
}

function sumCompletionSingleCell(cell,classname){
	var totalElements;
	var completedElements;
	if(cell.type == "number"){
		completedElements = savedata[classname][cell.id];
		if(cell.max){
			totalElements = cell.max;
		}
		else{
			totalElements = Math.max(1,completedElements);
		}
	}
	else{
		//we're a checkbox
		totalElements = 1;
		if(savedata[classname][cell.id]){
			completedElements = 1;
		}
		else{
			completedElements = 0;
		}
	}
	return [completedElements,totalElements];	
}
//Topbar percentage update and helper functions END