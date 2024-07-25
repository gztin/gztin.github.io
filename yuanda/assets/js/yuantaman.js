$(function () {
    setTimeout(function () 
        {$(".yuantaman-hibox").css('display','none');}, 20000
    );

    $(".yuantaman-icon").hover(function () {
            $(".yuantaman-box").css('display','flex');
            $(".yuantaman-hibox").css('display','none');
        },function(){
            $(".yuantaman-box").css('display','none');
        }
    );

    $(".yuantaman-icon").click(function () {
            $(".yuantaman-box").css('display','flex');
        },function(){
            $(".yuantaman-box").css('display','none');
        }
    );
})

