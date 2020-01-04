// JavaScript Document
//function raining(){
//    $('.weather').append('<div class="cloud" style="z-index:999;"></div>');
//    for(var i=1;i<10;i++){
//        var go = Math.floor(Math.random()*(i*8)+Math.random()*(i*8));
//        var down = Math.random()*(i+2.5);
//        $('.cloud').append('<div class="rain" style="left:'+go+'%;animation:raining infinite '+down+'s;"></div>');     
//    }  
//}
//raining();

$(function(){
   $.getJSON( "http://i-pingtung.com/OpenData/Attractions?start=100&limit=2000", function( json ) {
       console.log( "JSON Data: " + json );
   }); 
});


